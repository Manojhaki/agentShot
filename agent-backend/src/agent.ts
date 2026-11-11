import { getMcpClient } from "./mcpClient.js";
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
The shopper session is "{{sessionId}}"; the backend binds tools to this session.
Be concise and friendly.`;

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
  return tools.filter(t => t.name !== "confirm_checkout").map((t) => ({
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

async function ollamaChat(messages: OllamaMessage[], tools: OllamaTool[], signal?: AbortSignal) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal ?? AbortSignal.timeout(90_000),
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
  toolCalls: { name: string; input: unknown; output: string; isError: boolean }[];
}

const defaultDependencies = { tools: mcpToolsAsOllamaTools, call: callMcpTool, chat: ollamaChat };

export async function runAgentTurn(sessionId: string, userMessage: string, dependencies = defaultDependencies): Promise<ChatResult> {
  const deadline = AbortSignal.timeout(100_000);
  const history = conversations.get(sessionId) ?? [
    { role: "system", content: SYSTEM_PROMPT.replace("{{sessionId}}", sessionId) },
  ];
  history.push({ role: "user", content: userMessage });

  const tools = await dependencies.tools();
  const toolCalls: ChatResult["toolCalls"] = [];

  // Agent loop: keep calling the local model, executing any requested tool calls
  // via MCP, until it responds with plain text (no more tool_calls).
  for (let iteration = 0; iteration < 8; iteration++) {
    deadline.throwIfAborted();
    const message = await dependencies.chat(history, tools, deadline);
    history.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      conversations.set(sessionId, history);
      return { reply: safeReply(message.content), toolCalls };
    }

    for (const call of message.tool_calls) {
      let input: Record<string, unknown> = {};
      let result: { text: string; isError: boolean };
      try {
        deadline.throwIfAborted();
        input = bindSession(call.function.name, call.function.arguments, sessionId);
        result = await dependencies.call(call.function.name, input);
      } catch (error) { result = { text: (error as Error).message, isError: true }; }
      toolCalls.push({ name: call.function.name, input, output: result.text, isError: result.isError });
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
