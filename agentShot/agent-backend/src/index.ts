import "dotenv/config";
import cors from "cors";
import express from "express";
import { getMcpClient } from "./mcpClient.js";
import { resetConversation, runAgentTurn } from "./agent.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Direct catalog browsing (bypasses the agent for simple product grid rendering).
app.get("/api/products", async (_req, res) => {
  try {
    const client = await getMcpClient();
    const result = await client.callTool({ name: "search_products", arguments: {} });
    const text = (result.content as any[]).find((c) => c.type === "text")?.text ?? "[]";
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body ?? {};
  if (!sessionId || !message) {
    return res.status(400).json({ error: "sessionId and message are required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
  }
  try {
    const result = await runAgentTurn(sessionId, message);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/chat/reset", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (sessionId) resetConversation(sessionId);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`AgentShot backend listening on http://localhost:${PORT}`);
});
