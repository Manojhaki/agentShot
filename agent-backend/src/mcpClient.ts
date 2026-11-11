import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureContent, injectTrace, inSpan, recordError, SpanKind, telemetryEnvironment } from "@agentshot/telemetry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the compiled MCP server entrypoint in the sibling workspace package.
const mcpServerEntry = path.resolve(__dirname, "../../mcp-server/dist/index.js");

let clientPromise: Promise<Client> | null = null;

export async function closeMcpClient() {
  const current = clientPromise;
  clientPromise = null;
  if (current) await (await current).close();
}

export function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [mcpServerEntry],
        env: { ...getDefaultEnvironment(), ...telemetryEnvironment(), ...(process.env.AGENTSHOT_DB_PATH ? { AGENTSHOT_DB_PATH: process.env.AGENTSHOT_DB_PATH } : {}) },
      });
      const client = new Client({ name: "agentshot-backend", version: "1.0.0" });
      await client.connect(transport);
      return client;
    })().catch(error => { clientPromise = null; throw error; });
  }
  return clientPromise;
}

export function invokeMcpTool(name: string, args: Record<string, unknown>) {
  return inSpan(`mcp.client ${name}`, { "mcp.tool.name": name, "rpc.system.name": "mcp" }, async span => {
    captureContent(span, "mcp.tool.input", args);
    const client = await getMcpClient();
    const result = await client.callTool({ name, arguments: args, _meta: injectTrace() });
    span.setAttribute("mcp.tool.is_error", Boolean(result.isError));
    if (result.isError) recordError(span, new Error("MCP tool failed"), "mcp.tool_error");
    captureContent(span, "mcp.tool.output", result.content);
    return result;
  }, SpanKind.CLIENT);
}
