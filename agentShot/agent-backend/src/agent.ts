import { getMcpClient } from "./mcpClient.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const SYSTEM_PROMPT = `You are the shopping assistant for AgentShot, an ecommerce store.
You have tools to search the product catalog, recommend products, manage the shopper's
cart, and check out. Follow these rules strictly:
1. Never invent product names, ids, prices, stock, or descriptions. Only mention products
   that were returned by search_products, get_recommendations, or get_cart in this
   conversation, and only use their exact "id" field as productId in later tool calls.
2. The current shopper's sessionId is "{{sessionId}}" - pass it as the sessionId argument
   to any add_to_cart, remove_from_cart, get_cart, or checkout tool call.
3. Never claim an order was placed, confirmed, or paid for unless you actually called the
   checkout tool in this conversation and it returned a successful result. If you have not
   called checkout yet, you have not placed an order.
4. If a tool call returns an error, do not pretend it succeeded - read the error, fix the
   arguments (e.g. look up the correct productId via search_products or get_cart), and try
   again, or tell the user what went wrong.
Be concise, friendly, and proactive: suggest relevant products when helpful, and confirm
cart/order details clearly including exact prices and totals from tool results.`;

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
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
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema,
    },
  }));
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return { text: text || JSON.stringify(result), isError: Boolean(result.isError) };
}

async function ollamaChat(messages: OllamaMessage[], tools: OllamaTool[]) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools, stream: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${res.status}): ${body || res.statusText}. ` +
        `Is Ollama running and has "${MODEL}" been pulled (ollama pull ${MODEL})?`,
    );
  }
  const data = (await res.json()) as { message: OllamaMessage };
  return data.message;
}

export interface ChatResult {
  reply: string;
  toolCalls: { name: string; input: unknown; output: string }[];
}

// Guards against the model claiming a completed/confirmed order when it never
// actually invoked the checkout tool - a common small-model hallucination.
const FABRICATED_CHECKOUT_RE =
  /order (has been|is|was)\s*(successfully\s*)?(placed|confirmed|complete)|successfully (placed|processed)|processed (the )?(payment|your order)/i;

function isFabricatedCheckoutClaim(replyText: string, toolCalls: ChatResult["toolCalls"]): boolean {
  return FABRICATED_CHECKOUT_RE.test(replyText) && !toolCalls.some((tc) => tc.name === "checkout");
}

export async function runAgentTurn(sessionId: string, userMessage: string): Promise<ChatResult> {
  const history = conversations.get(sessionId) ?? [
    { role: "system", content: SYSTEM_PROMPT.replace("{{sessionId}}", sessionId) },
  ];
  history.push({ role: "user", content: userMessage });

  const tools = await mcpToolsAsOllamaTools();
  const toolCalls: ChatResult["toolCalls"] = [];

  // Agent loop: keep calling the local model, executing any requested tool calls
  // via MCP, until it responds with plain text (no more tool_calls).
  for (let iteration = 0; iteration < 8; iteration++) {
    const message = await ollamaChat(history, tools);
    history.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (isFabricatedCheckoutClaim(message.content, toolCalls) && iteration < 7) {
        history.push({
          role: "user",
          content:
            "You did not actually call the checkout tool, so no order has been placed. " +
            "Do not claim an order is complete unless you call checkout and it succeeds. " +
            "Call the checkout tool now if the shopper wants to complete their purchase " +
            "(ask for a shipping address first if you don't have one).",
        });
        continue;
      }
      conversations.set(sessionId, history);
      return { reply: message.content, toolCalls };
    }

    for (const call of message.tool_calls) {
      const input = { ...(call.function.arguments as Record<string, unknown>) };
      if (
        ["add_to_cart", "remove_from_cart", "get_cart", "checkout"].includes(call.function.name) &&
        !input.sessionId
      ) {
        input.sessionId = sessionId;
      }
      const result = await callMcpTool(call.function.name, input);
      toolCalls.push({ name: call.function.name, input, output: result.text });
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
