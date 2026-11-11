import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { getMcpClient } from "./mcpClient.js";
import { resetConversation, runAgentTurn } from "./agent.js";

export async function callStore(name: string, args: Record<string, unknown>) {
  const client = await getMcpClient();
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).filter(c => c.type === "text").map(c => c.text).join("\n");
  if (result.isError) throw new Error(text || "Store action failed.");
  return JSON.parse(text);
}
export function createApp(storeCall = callStore, agentTurn = runAgentTurn) {
  const app = express();
  const allowed = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || origin === process.env.WEB_ORIGIN;
  app.use((req, res, next) => {
    if (req.headers.origin && !allowed(req.headers.origin)) { res.status(403).json({ error: "Origin is not allowed." }); return; }
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowed(origin)), credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    const cookie = req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith("agentshot_session="))?.slice(18);
    const session = cookie && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cookie) ? cookie : randomUUID();
    if (session !== cookie) res.cookie("agentshot_session", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 86400_000 });
    res.locals.sessionId = session;
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const action = (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      try { await handler(req, res); }
      catch (err) { res.status(409).json({ error: (err as Error).message }); }
    };
  app.get("/api/products", action(async (_req, res) => { res.json(await storeCall("search_products", {})); }));
  app.get("/api/state", action(async (_req, res) => { res.json(await storeCall("get_shopper_state", { sessionId: res.locals.sessionId })); }));
  app.post("/api/cart", action(async (req, res) => {
    const { productId, quantity = 1, operation = "add" } = req.body ?? {};
    if (typeof productId !== "string" || !["add", "remove"].includes(operation) || !Number.isSafeInteger(quantity) || quantity < 1) {
      res.status(400).json({ error: "Provide a product, operation and positive whole quantity." }); return;
    }
    res.json(await storeCall(operation === "add" ? "add_to_cart" : "remove_from_cart", { sessionId: res.locals.sessionId, productId, quantity }));
  }));
  app.post("/api/checkout/review", action(async (req, res) => {
    if (typeof req.body?.shippingAddress !== "string") { res.status(400).json({ error: "Shipping address is required." }); return; }
    res.json(await storeCall("prepare_checkout", { sessionId: res.locals.sessionId, shippingAddress: req.body.shippingAddress }));
  }));
  app.post("/api/bundle/preview", action(async (req, res) => {
    const budget = req.body?.budget ?? 150;
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 1 || budget > 10000) {
      res.status(400).json({ error: "Enter a budget between $1 and $10,000." }); return;
    }
    res.json(await storeCall("plan_hiking_bundle", { sessionId: res.locals.sessionId, budget }));
  }));
  app.post("/api/bundle/apply", action(async (req, res) => {
    if (typeof req.body?.bundleId !== "string") { res.status(400).json({ error: "Preview a bundle first." }); return; }
    res.json(await storeCall("apply_hiking_bundle", { sessionId: res.locals.sessionId, bundleId: req.body.bundleId }));
  }));
  app.post("/api/checkout/confirm", action(async (req, res) => {
    if (typeof req.body?.reviewId !== "string" || req.body?.confirmed !== true) { res.status(400).json({ error: "Explicit confirmation and a checkout review are required." }); return; }
    res.json(await storeCall("confirm_checkout", { sessionId: res.locals.sessionId, reviewId: req.body.reviewId }));
  }));
  const busy = new Set<string>();
  app.post("/api/chat", action(async (req, res) => {
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 4000) { res.status(400).json({ error: "Enter a message of 1-4000 characters." }); return; }
    const session = res.locals.sessionId as string;
    if (busy.has(session)) { res.status(409).json({ error: "Please wait for the previous reply." }); return; }
    busy.add(session);
    try { res.json(await agentTurn(session, message.trim())); } finally { busy.delete(session); }
  }));
  app.post("/api/chat/reset", (req, res) => { resetConversation(res.locals.sessionId); res.json({ ok: true }); });
  return app;
}
