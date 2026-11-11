import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import seed from "../mcp-server/dist/data/products.json" with { type: "json" };
import { createApp, callStore } from "../agent-backend/dist/app.js";
import { closeMcpClient } from "../agent-backend/dist/mcpClient.js";

test("HTTP + real MCP: isolated sessions, reviewed purchase, replay and saved receipt", async t => {
  const directory = mkdtempSync(join(tmpdir(), "agentshot-api-"));
  process.env.AGENTSHOT_DB_PATH = join(directory, "test.sqlite");
  process.env.AGENTSHOT_TELEMETRY_DIR = join(directory, "traces");
  let agentSession;
  const server = createApp(callStore, async session => {
    agentSession = session;
    return { reply: "Hello", toolCalls: [] };
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await closeMcpClient();
    delete process.env.AGENTSHOT_DB_PATH;
    delete process.env.AGENTSHOT_TELEMETRY_DIR;
    rmSync(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body, cookie, origin) {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(origin ? { origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const alice = await request("/state");
  const bob = await request("/state");
  assert.notEqual(alice.cookie, bob.cookie);
  assert.equal(alice.data.cart.itemCount, 0);
  const products = await request("/products", undefined, alice.cookie);
  assert.equal(products.data.length, seed.length);
  assert.equal((await request("/cart", { productId: "p001", quantity: -1 }, alice.cookie)).status, 400);
  assert.equal((await request("/cart", { productId: "p001", sessionId: bob.cookie }, alice.cookie)).status, 200);
  assert.equal((await request("/state", undefined, bob.cookie)).data.cart.itemCount, 0);
  assert.equal((await request("/chat", { message: "hello", sessionId: "forged" }, alice.cookie)).status, 200);
  assert.equal(agentSession, alice.cookie.split("=")[1]);
  assert.equal((await request("/chat", { message: {} }, alice.cookie)).status, 400);
  assert.equal((await request("/cart", { productId: "p001" }, alice.cookie, "https://untrusted.example")).status, 403);
  const review = await request("/checkout/review", { shippingAddress: "123 Test Street, Boston MA 02110, US" }, alice.cookie);
  assert.equal(review.status, 200);
  assert.equal((await request("/state", undefined, alice.cookie)).data.orders.length, 0);
  assert.equal((await request("/checkout/confirm", { reviewId: review.data.reviewId }, alice.cookie)).status, 400);
  assert.equal((await request("/checkout/confirm", { reviewId: review.data.reviewId, confirmed: true }, bob.cookie)).status, 409);
  const purchase = { reviewId: review.data.reviewId, confirmed: true };
  const [order, concurrentRetry] = await Promise.all([
    request("/checkout/confirm", purchase, alice.cookie),
    request("/checkout/confirm", purchase, alice.cookie),
  ]);
  assert.equal(order.status, 200);
  assert.equal(order.data.total, 140.39);
  assert.equal(order.data.status, "confirmed");
  assert.equal(concurrentRetry.data.orderId, order.data.orderId);
  const retry = await request("/checkout/confirm", purchase, alice.cookie);
  assert.equal(retry.data.orderId, order.data.orderId);
  const state = (await request("/state", undefined, alice.cookie)).data;
  assert.equal(state.cart.itemCount, 0);
  assert.equal(state.orders.length, 1);
  assert.equal((await request("/state", undefined, bob.cookie)).data.orders.length, 0);
  assert.equal((await request("/products", undefined, alice.cookie)).data.find(p => p.id === "p001").stock, products.data.find(p => p.id === "p001").stock - 1);
  assert.equal((await request("/bundle/preview", { budget: -1 }, bob.cookie)).status, 400);
  const bundle = await request("/bundle/preview", { budget: 150, sessionId: "forged" }, bob.cookie);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.data.projectedCart.total, 143.09);
  assert.equal((await request("/state", undefined, bob.cookie)).data.cart.itemCount, 0);
  assert.equal((await request("/bundle/apply", { bundleId: bundle.data.bundleId }, alice.cookie)).status, 409);
  const [added, replay] = await Promise.all([
    request("/bundle/apply", { bundleId: bundle.data.bundleId }, bob.cookie),
    request("/bundle/apply", { bundleId: bundle.data.bundleId }, bob.cookie),
  ]);
  assert.equal(added.status, 200);
  assert.equal(added.data.itemCount, 3);
  assert.equal(replay.data.itemCount, 3);
  const afterBundle = (await request("/state", undefined, bob.cookie)).data;
  assert.equal(afterBundle.bundle, null);
  assert.equal(afterBundle.orders.length, 0);
  assert.equal(afterBundle.cart.total, 143.09);
});
