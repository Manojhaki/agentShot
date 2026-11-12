import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeTelemetry, flushTelemetry, shutdownTelemetry } from "@agentshot/telemetry";
import { createTraceViewer, readSpans } from "../telemetry/viewer.mjs";

test("OpenTelemetry traces actual HTTP, Ollama, MCP stdio and SQLite with opt-in content", async t => {
  const directory = mkdtempSync(join(tmpdir(), "agentshot-otel-"));
  let requestedThink;
  const ollama = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requestedThink = body.think;
    const user = body.messages.findLast(m => m.role === "user").content;
    const needsTool = body.messages.at(-1).role !== "tool";
    const failure = user.includes("FAIL_TOOL");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      model: "fixture-model", done: true, done_reason: "stop",
      prompt_eval_count: 13, eval_count: 7, total_duration: 123000000, load_duration: 1000000,
      message: {
        role: "assistant", content: needsTool ? "" : failure ? "The item could not be added." : "Preview ready in the bundle panel.",
        ...(user.includes("NO_THINKING") ? {} : { thinking: "PROVIDER_THINKING_SENTINEL: checking the available tool." }),
        ...(needsTool ? { tool_calls: [{ function: failure
          ? { name: "add_to_cart", arguments: { productId: "unknown-product", sessionId: "wrong-shopper", quantity: 1 } }
          : { name: "plan_hiking_bundle", arguments: { budget: 150, sessionId: "wrong-shopper" } }
        }] } : {}),
      },
    }));
  }).listen(0, "127.0.0.1");
  await once(ollama, "listening");
  process.env.OLLAMA_URL = "http://127.0.0.1:" + ollama.address().port;
  process.env.AGENTSHOT_DB_PATH = join(directory, "test.sqlite");
  process.env.AGENTSHOT_TELEMETRY_DIR = join(directory, "traces");
  process.env.AGENTSHOT_OTEL_EXPORTER = "file";
  process.env.OTEL_CAPTURE_CONTENT = "false";
  initializeTelemetry("agentshot-backend");
  const { createApp } = await import("../agent-backend/dist/app.js");
  const { closeMcpClient } = await import("../agent-backend/dist/mcpClient.js");
  const app = createApp().listen(0, "127.0.0.1");
  await once(app, "listening");
  const viewer = createTraceViewer(process.env.AGENTSHOT_TELEMETRY_DIR).listen(0, "127.0.0.1");
  await once(viewer, "listening");
  t.after(async () => {
    await Promise.all([app, viewer, ollama].map(s => new Promise(resolve => s.close(resolve))));
    await closeMcpClient();
    await shutdownTelemetry();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + app.address().port;
  async function chat(message, traceparent) {
    const response = await fetch(base + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json", ...(traceparent ? { traceparent } : {}) }, body: JSON.stringify({ message }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.match(data.traceId, /^[a-f0-9]{32}$/);
    assert.equal(response.headers.get("x-trace-id"), data.traceId);
    await flushTelemetry();
    return { data, cookie: response.headers.get("set-cookie").split(";")[0], spans: readSpans(process.env.AGENTSHOT_TELEMETRY_DIR).filter(s => s.traceId === data.traceId) };
  }
  await t.test("single correlated trace, exact parentage and token usage; no shopper or reasoning content by default", async () => {
    const result = await chat("PRIVATE_PROMPT_SENTINEL ship to 123 Private Street, Boston MA 02110");
    const spans = result.spans;
    const root = spans.find(s => s.name === "POST /api/chat");
    const agent = spans.find(s => s.name === "agent.turn");
    const client = spans.find(s => s.name === "mcp.client plan_hiking_bundle");
    const server = spans.find(s => s.name === "mcp.server plan_hiking_bundle");
    const store = spans.find(s => s.name === "store.planHikingBundle");
    const transaction = spans.find(s => s.name === "sqlite.transaction");
    assert.ok(root && agent && client && server && store && transaction);
    assert.equal(agent.parentSpanId, root.spanId);
    assert.equal(client.parentSpanId, agent.spanId);
    assert.equal(server.parentSpanId, client.spanId);
    assert.equal(store.parentSpanId, server.spanId);
    assert.equal(transaction.parentSpanId, store.spanId);
    assert.equal(server.service, "agentshot-mcp");
    const model = spans.find(s => s.name.startsWith("chat "));
    assert.equal(model.attributes["gen_ai.usage.input_tokens"], 13);
    assert.equal(model.attributes["gen_ai.usage.output_tokens"], 7);
    assert.equal(model.attributes["ollama.thinking.available"], true);
    assert.equal(model.events.some(e => e.name === "gen_ai.reasoning"), false);
    const encoded = JSON.stringify(spans);
    for (const value of ["PRIVATE_PROMPT_SENTINEL", "Private Street", "PROVIDER_THINKING_SENTINEL", result.cookie.split("=")[1]]) assert.equal(encoded.includes(value), false);
    assert.ok(agent.events.some(e => e.name === "agent.tool.selected"));
  });
  await t.test("one journey connects separate cart, review and order traces without exposing cookies", async () => {
    const first = await fetch(base + "/api/state");
    const cookie = first.headers.get("set-cookie").split(";")[0];
    await first.json();
    const ids = [first.headers.get("x-trace-id")];
    async function post(path, body) {
      const response = await fetch(base + path, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      ids.push(response.headers.get("x-trace-id"));
      return response.json();
    }
    await post("/api/cart", { productId: "p001" });
    const review = await post("/api/checkout/review", { shippingAddress: "123 Test Street, Boston MA 02110, US" });
    await post("/api/checkout/confirm", { reviewId: review.reviewId, confirmed: true });
    const other = await fetch(base + "/api/state"); await other.json();
    await flushTelemetry();
    const spans = readSpans(process.env.AGENTSHOT_TELEMETRY_DIR);
    const roots = ids.map(id => spans.find(span => span.traceId === id && !span.parentSpanId));
    assert.ok(roots.every(Boolean));
    const journey = roots[0].attributes["agentshot.journey.id"];
    assert.match(journey, /^shopper-[a-f0-9]{64}$/);
    assert.ok(roots.every(span => span.attributes["agentshot.journey.id"] === journey));
    assert.equal(new Set(ids).size, ids.length);
    const otherRoot = spans.find(span => span.traceId === other.headers.get("x-trace-id") && !span.parentSpanId);
    assert.notEqual(otherRoot.attributes["agentshot.journey.id"], journey);
    assert.equal(JSON.stringify(spans).includes(cookie.split("=")[1]), false);
  });
  await t.test("provider reasoning is captured only with content opt-in and not exposed in chat replies", async () => {
    process.env.OTEL_CAPTURE_CONTENT = "true";
    process.env.OLLAMA_THINK = "true";
    await closeMcpClient(); // Child receives the updated explicit content setting.
    const result = await chat("OPT_IN_PROMPT_SENTINEL");
    assert.equal(requestedThink, true);
    const event = result.spans.flatMap(s => s.events).find(e => e.name === "gen_ai.reasoning");
    assert.ok(event);
    assert.match(event.attributes.content, /PROVIDER_THINKING_SENTINEL/);
    assert.match(event.attributes.content, /ollama.message.thinking/);
    assert.equal(JSON.stringify(result.data).includes("PROVIDER_THINKING_SENTINEL"), false);
    assert.equal(JSON.stringify(result.spans).includes(result.cookie.split("=")[1]), false);
    const request = result.spans.find(s => s.name === "mcp.server plan_hiking_bundle").events.find(e => e.name === "mcp.tool.input");
    assert.match(request.attributes.content, /redacted/);
  });
  await t.test("no reasoning event is invented when the provider omits thinking", async () => {
    const result = await chat("NO_THINKING");
    const models = result.spans.filter(s => s.name.startsWith("chat "));
    assert.ok(models.every(s => s.attributes["ollama.thinking.available"] === false));
    assert.ok(models.every(s => !s.events.some(e => e.name === "gen_ai.reasoning")));
  });
  await t.test("content events are bounded and labeled when truncated", async () => {
    process.env.OTEL_CONTENT_MAX_BYTES = "256";
    const result = await chat("NO_THINKING " + "x".repeat(1000));
    const event = result.spans.find(s => s.name === "agent.turn").events.find(e => e.name === "agent.user_message");
    assert.equal(event.attributes["content.truncated"], true);
    assert.ok(Buffer.byteLength(event.attributes.content) <= 256);
    delete process.env.OTEL_CONTENT_MAX_BYTES;
  });
  await t.test("incoming W3C context continues through HTTP and MCP", async () => {
    const result = await chat("NO_THINKING", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
    assert.equal(result.data.traceId, "0123456789abcdef0123456789abcdef");
    assert.equal(result.spans.find(s => s.name === "POST /api/chat").parentSpanId, "0123456789abcdef");
    assert.ok(result.spans.some(s => s.name === "mcp.server plan_hiking_bundle"));
  });
  await t.test("failed tool results mark client, MCP server and agent spans as errors", async () => {
    process.env.OTEL_CAPTURE_CONTENT = "false";
    await closeMcpClient();
    const result = await chat("FAIL_TOOL PRIVATE_ERROR_PROMPT");
    for (const name of ["mcp.client add_to_cart", "mcp.server add_to_cart", "agent.turn"])
      assert.equal(result.spans.find(s => s.name === name).status.code, 2);
    assert.equal(JSON.stringify(result.spans).includes("PRIVATE_ERROR_PROMPT"), false);
  });
  await t.test("local viewer reads spans without accepting remote Host headers", async () => {
    const url = "http://127.0.0.1:" + viewer.address().port;
    const spans = await (await fetch(url + "/api/spans")).json();
    assert.ok(spans.some(s => s.name === "agent.turn"));
    const rejected = await new Promise((resolve, reject) => {
      const req = httpRequest(url + "/", { headers: { Host: "external.example" } }, response => { response.resume(); resolve(response.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(rejected, 403);
    assert.equal((await fetch(url + "/")).status, 200);
    for (const path of ["/viewer.js", "/viewer.css", "/trace-model.mjs"]) assert.equal((await fetch(url + path)).status, 200);
    assert.equal((await fetch(url + "/../package.json")).status, 404);
  });
});
