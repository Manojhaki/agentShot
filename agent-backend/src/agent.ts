import { getMcpClient, invokeMcpTool } from "./mcpClient.js";
import { captureContent, contentEnabled, inSpan, recordError, SpanKind, trace } from "@agentshot/telemetry";
import { bindSession, safeReply } from "./policy.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const SYSTEM_PROMPT = `You are the shopping assistant for AgentShot, a demo store.
Use tools for exact product names, IDs, stock, prices, cart contents and saved orders.
Never invent products or treat tool errors as success. Search before adding an unknown product.
Use prepare_checkout to prepare a review when given a full shipping address.
A review does NOT place an order. Tell the shopper to review the cart panel and click
Confirm demo order. You cannot confirm orders or process payments.
Use get_shopper_state for current cart and saved order history.
For hiking kit or hiking bundle requests, use plan_hiking_bundle with the shopper's budget
(default $150 including existing cart and demo tax). It only prepares a preview. Do not
add the planned products individually; ask the shopper to click Add hiking bundle.
For bundle replies, items are NEW picks; projectedCart includes what the shopper already
has. Distinguish additionalTotal from projectedCart.total and do not describe existing
items as new additions.
The shopper session is "{{sessionId}}"; the backend binds tools to this session.
Be concise and friendly.`;

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

interface OllamaTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

const conversations = new Map<string, OllamaMessage[]>();

async function mcpToolsAsOllamaTools(): Promise<OllamaTool[]> {
  const client = await getMcpClient();
  const { tools } = await client.listTools();
  return tools.filter(t => !["confirm_checkout", "apply_hiking_bundle"].includes(t.name)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema,
    },
  }));
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const result = await invokeMcpTool(name, args);
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { text: text || JSON.stringify(result), isError: Boolean(result.isError) };
}

async function ollamaChat(messages: OllamaMessage[], tools: OllamaTool[], signal?: AbortSignal) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal ?? AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: MODEL, messages, tools, stream: false, ...(process.env.OLLAMA_THINK ? { think: process.env.OLLAMA_THINK === "true" ? true : process.env.OLLAMA_THINK === "false" ? false : process.env.OLLAMA_THINK } : {}) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${res.status}): ${body || res.statusText}. ` +
        `Is Ollama running and has "${MODEL}" been pulled (ollama pull ${MODEL})?`,
    );
  }
  const data = (await res.json()) as {
    message: OllamaMessage; model?: string; prompt_eval_count?: number; eval_count?: number;
    total_duration?: number; load_duration?: number; prompt_eval_duration?: number; eval_duration?: number; done_reason?: string;
  };
  const span = trace.getActiveSpan();
  if (span) {
    for (const [key, value] of [
      ["gen_ai.usage.input_tokens", data.prompt_eval_count], ["gen_ai.usage.output_tokens", data.eval_count],
      ["ollama.total_duration_ns", data.total_duration], ["ollama.load_duration_ns", data.load_duration],
      ["ollama.prompt_eval_duration_ns", data.prompt_eval_duration], ["ollama.eval_duration_ns", data.eval_duration],
    ] as const) if (typeof value === "number" && Number.isFinite(value)) span.setAttribute(key, value);
    if (data.done_reason) span.setAttribute("gen_ai.response.finish_reasons", [data.done_reason]);
    if (data.model) span.setAttribute("gen_ai.response.model", data.model);
  }
  return data.message;
}

export interface ChatResult {
  reply: string;
  toolCalls: { name: string; input: unknown; output: string; isError: boolean }[];
}

const defaultDependencies = { tools: mcpToolsAsOllamaTools, call: callMcpTool, chat: ollamaChat };

function isCartQuestion(message: string): boolean {
  const text = message.trim().replace(/[’]/g, "'");
  return /^(?:(?:please|can you|could you)\s+)*(?:(?:what(?:'s| is| are)\s+(?:currently\s+)?in\s+(?:my|the)\s+cart)|(?:(?:show|view|check|list|read|display)\s+(?:me\s+)?(?:the\s+)?(?:(?:items|contents)\s+(?:of|in)\s+)?my\s+cart)|my\s+cart)(?:\s+(?:contents|items|please|right now|now|currently))*[?.!\s]*$/i.test(text);
}

function cartReply(text: string): string {
  const cart = JSON.parse(text) as { items: { name: string; quantity: number; lineTotal: number }[]; subtotal: number; tax: number; total: number };
  if (!Array.isArray(cart.items) || ![cart.subtotal, cart.tax, cart.total].every(Number.isFinite)
    || cart.items.some(item => typeof item.name !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.lineTotal))) {
    throw new Error("Invalid cart response");
  }
  if (!cart.items.length) return "Your cart is empty.";
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  return "Your current cart:\n" + cart.items.map(item => `• ${item.name} × ${item.quantity} — ${money(item.lineTotal)}`).join("\n")
    + `\n\nSubtotal: ${money(cart.subtotal)}\nDemo tax: ${money(cart.tax)}\nTotal: ${money(cart.total)}`;
}

export function runAgentTurn(sessionId: string, userMessage: string, dependencies = defaultDependencies): Promise<ChatResult> {
  return inSpan("agent.turn", {
    "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "AgentShot shopping assistant",
    "gen_ai.request.model": MODEL, "agent.content_capture_enabled": contentEnabled(),
  }, async span => {
    captureContent(span, "agent.user_message", userMessage);
    const result = await runAgentTurnInternal(sessionId, userMessage, dependencies);
    span.setAttribute("agent.tool_call_count", result.toolCalls.length);
    captureContent(span, "agent.reply", result.reply);
    return result;
  });
}
async function runAgentTurnInternal(sessionId: string, userMessage: string, dependencies = defaultDependencies): Promise<ChatResult> {
  const deadline = AbortSignal.timeout(100_000);
  const history = conversations.get(sessionId) ?? [
    { role: "system", content: SYSTEM_PROMPT.replace("{{sessionId}}", sessionId) },
  ];
  history.push({ role: "user", content: userMessage });

  // Cart reads must use live store data, even when the model skips tools or remembers an old cart.
  if (isCartQuestion(userMessage)) {
    const input = bindSession("get_cart", {}, sessionId);
    trace.getActiveSpan()?.addEvent("agent.tool.selected", { "gen_ai.tool.name": "get_cart", "agent.source": "cart_question" });
    let result: { text: string; isError: boolean };
    let reply: string;
    try {
      result = await dependencies.call("get_cart", input);
      reply = result.isError ? "I couldn't read your current cart. Please try again or refresh the store." : cartReply(result.text);
    } catch {
      result = { text: "Could not read the current cart.", isError: true };
      reply = "I couldn't read your current cart. Please try again or refresh the store.";
    }
    trace.getActiveSpan()?.addEvent("agent.tool.result", { "gen_ai.tool.name": "get_cart", "tool.is_error": result.isError });
    if (result.isError && trace.getActiveSpan()) recordError(trace.getActiveSpan()!, new Error("Cart read failed"), "agent.tool_error");
    history.push({ role: "assistant", content: reply });
    conversations.set(sessionId, history);
    return { reply, toolCalls: [{ name: "get_cart", input, output: result.text, isError: result.isError }] };
  }

  const tools = await inSpan("mcp.list_tools", {}, () => dependencies.tools(), SpanKind.CLIENT);
  const toolCalls: ChatResult["toolCalls"] = [];

  // Agent loop: keep calling the local model, executing any requested tool calls
  // via MCP, until it responds with plain text (no more tool_calls).
  for (let iteration = 0; iteration < 8; iteration++) {
    deadline.throwIfAborted();
    const message = await inSpan(`chat ${MODEL}`, {
      "gen_ai.operation.name": "chat", "gen_ai.provider.name": "ollama",
      "gen_ai.request.model": MODEL, "agent.iteration": iteration + 1,
    }, async span => {
      captureContent(span, "gen_ai.input.messages", history.map(m => m.role === "system" ? { role: m.role, content: "[system instructions omitted]" } : m));
      const reply = await dependencies.chat(history, tools, deadline);
      span.setAttributes({
        "gen_ai.response.tool_call_count": reply.tool_calls?.length ?? 0,
        "ollama.thinking.available": Boolean(reply.thinking),
        "ollama.thinking.characters": reply.thinking?.length ?? 0,
      });
      // Capture only provider-returned thinking, never manufacture hidden reasoning.
      if (reply.thinking) captureContent(span, "gen_ai.reasoning", { source: "ollama.message.thinking", text: reply.thinking });
      captureContent(span, "gen_ai.output.message", { content: reply.content, tool_calls: reply.tool_calls });
      return reply;
    }, SpanKind.CLIENT);
    history.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      conversations.set(sessionId, history);
      return { reply: safeReply(message.content), toolCalls };
    }

    for (const call of message.tool_calls) {
      const toolName = tools.some(tool => tool.function.name === call.function.name) ? call.function.name : "unknown_tool";
      trace.getActiveSpan()?.addEvent("agent.tool.selected", { "gen_ai.tool.name": toolName, "agent.iteration": iteration + 1 });
      let input: Record<string, unknown> = {};
      let result: { text: string; isError: boolean };
      try {
        deadline.throwIfAborted();
        input = bindSession(call.function.name, call.function.arguments, sessionId);
        result = await dependencies.call(call.function.name, input);
      } catch (error) { result = { text: (error as Error).message, isError: true }; }
      toolCalls.push({ name: call.function.name, input, output: result.text, isError: result.isError });
      trace.getActiveSpan()?.addEvent("agent.tool.result", { "gen_ai.tool.name": toolName, "tool.is_error": result.isError });
      if (result.isError) {
        const span = trace.getActiveSpan();
        if (span) recordError(span, new Error("Tool execution failed"), "agent.tool_error");
      }
      history.push({ role: "tool", content: result.text });
    }
  }

  conversations.set(sessionId, history);
  return {
    reply: "Sorry, that took too many steps to resolve. Could you rephrase your request?",
    toolCalls,
  };
}

export function resetConversation(sessionId: string) {
  conversations.delete(sessionId);
}
