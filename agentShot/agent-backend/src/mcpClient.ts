import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the compiled MCP server entrypoint in the sibling workspace package.
const mcpServerEntry = path.resolve(__dirname, "../../mcp-server/dist/index.js");

let clientPromise: Promise<Client> | null = null;

export function getMcpClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [mcpServerEntry],
      });
      const client = new Client({ name: "agentshot-backend", version: "1.0.0" });
      await client.connect(transport);
      return client;
    })();
  }
  return clientPromise;
}
