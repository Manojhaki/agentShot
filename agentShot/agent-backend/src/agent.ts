import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getMcpClient } from "./mcpClient.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

const SYSTEM_PROMPT = `You are the shopping assistant for AgentShot, an ecommerce store.
You have tools to search the product catalog, recommend products, manage the shopper's
cart, and check out. Always use tools rather than guessing product details, prices, or
stock. The current shopper's sessionId is "{{sessionId}}" - pass it to any cart/checkout
tool call that requires one. Be concise, friendly, and proactive: suggest relevant
products or recommendations when helpful, and confirm cart/order details clearly
including prices and totals. Never invent a checkout confirmation yourself; always call
the checkout tool.`;

type ConversationMessage = Anthropic.MessageParam;

const conversations = new Map<string, ConversationMessage[]>();

async function mcpToolsAsAnthropicTools(): Promise<Tool[]> {
  const client = await getMcpClient();
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Tool["input_schema"],
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

export interface ChatResult {
  reply: string;
  toolCalls: { name: string; input: unknown; output: string }[];
}

export async function runAgentTurn(sessionId: string, userMessage: string): Promise<ChatResult> {
  const history = conversations.get(sessionId) ?? [];
  history.push({ role: "user", content: userMessage });

  const tools = await mcpToolsAsAnthropicTools();
  const toolCalls: ChatResult["toolCalls"] = [];
  const system = SYSTEM_PROMPT.replace("{{sessionId}}", sessionId);

  // Agent loop: keep calling Claude, executing any requested tool calls via MCP,
  // until it responds with a plain text turn (no more tool_use blocks).
  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages: history,
    });

    history.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      conversations.set(sessionId, history);
      return { reply: text, toolCalls };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const input = { ...(block.input as Record<string, unknown>) };
      if (
        ["add_to_cart", "remove_from_cart", "get_cart", "checkout"].includes(block.name) &&
        !input.sessionId
      ) {
        input.sessionId = sessionId;
      }
      const result = await callMcpTool(block.name, input);
      toolCalls.push({ name: block.name, input, output: result.text });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.text,
        is_error: result.isError,
      });
    }
    history.push({ role: "user", content: toolResults });
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
