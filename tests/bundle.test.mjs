import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../mcp-server/dist/store.js";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "agentshot-bundle-"));
  const file = join(directory, "test.sqlite");
  const store = new Store(file);
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  return { store, file };
}
test("default hiking preview includes exact taxed totals and never changes the cart", t => {
  const { store } = fixture(t);
  const plan = store.planHikingBundle("alice");
  assert.deepEqual(plan.items.map(i => i.productId), ["p003", "p004", "p021"]);
  assert.equal(plan.projectedCart.subtotal, 132.49);
  assert.equal(plan.projectedCart.tax, 10.6);
  assert.equal(plan.projectedCart.total, 143.09);
  assert.equal(plan.additionalTotal, 143.09);
  assert.equal(store.cartSummary("alice").itemCount, 0);
  assert.equal(store.shopperState("alice").bundle.bundleId, plan.bundleId);
  assert.equal(store.shopperState("bob").bundle, null);
});
test("budget includes the existing cart and tax, and avoids duplicate hiking items", t => {
  const { store } = fixture(t);
  store.addToCart("alice", "p004", 1);
  store.prepareCheckout("alice", "123 Test Street, Boston MA 02110, US");
  const plan = store.planHikingBundle("alice", 150);
  assert.equal(plan.items.some(i => i.productId === "p004"), false);
  assert.equal(plan.projectedCart.total, 143.09);
  assert.equal(plan.additionalTotal, 117.17);
  const cart = store.applyHikingBundle("alice", plan.bundleId);
  assert.equal(store.shopperState("alice").review, null);
  assert.equal(cart.items.find(i => i.productId === "p004").quantity, 1);
  assert.deepEqual(cart, { ...plan.projectedCart, items: plan.projectedCart.items.map(({ reason, ...line }) => line).sort((a,b) => a.productId.localeCompare(b.productId)) });
});
test("small budgets return affordable picks and invalid or impossible budgets fail", t => {
  const { store } = fixture(t);
  const plan = store.planHikingBundle("alice", 50);
  assert.deepEqual(plan.items.map(i => i.productId), ["p004", "p021"]);
  assert.equal(plan.projectedCart.total, 46.43);
  for (const budget of [0, -1, NaN, Infinity, 10001, 1.001]) assert.throws(() => store.planHikingBundle("alice", budget), /budget/);
  assert.throws(() => store.planHikingBundle("alice", 10), /No additional/);
  store.addToCart("alice", "p001", 1);
  assert.throws(() => store.planHikingBundle("alice", 100), /current cart already/);
});
test("saved bundle is session-bound, persistent and idempotent even after later cart changes", t => {
  const { store, file } = fixture(t);
  const plan = store.planHikingBundle("alice", 150);
  assert.throws(() => store.applyHikingBundle("bob", plan.bundleId), /Preview a hiking/);
  store.close();
  const reopened = new Store(file);
  try {
    const cart = reopened.applyHikingBundle("alice", plan.bundleId);
    assert.equal(cart.itemCount, 3);
    assert.equal(reopened.shopperState("alice").bundle, null);
    assert.deepEqual(reopened.applyHikingBundle("alice", plan.bundleId), cart);
    reopened.addToCart("alice", "p004", 1);
    assert.equal(reopened.applyHikingBundle("alice", plan.bundleId).itemCount, 4);
    assert.equal(reopened.shopperState("alice").orders.length, 0);
  } finally { reopened.close(); }
});
test("cart edits invalidate pending previews and require rebuilding", t => {
  const { store } = fixture(t);
  const plan = store.planHikingBundle("alice");
  store.addToCart("alice", "p004", 1);
  assert.equal(store.shopperState("alice").bundle, null);
  assert.throws(() => store.applyHikingBundle("alice", plan.bundleId), /cart changed/);
  assert.equal(store.cartSummary("alice").itemCount, 1);
});
test("stock changes reject the whole bundle atomically and unavailable picks are excluded", t => {
  const { store, file } = fixture(t);
  const plan = store.planHikingBundle("alice");
  const db = new DatabaseSync(file);
  db.prepare("UPDATE products SET stock = 0 WHERE id = ?").run("p021");
  db.close();
  assert.throws(() => store.applyHikingBundle("alice", plan.bundleId), /Stock changed/);
  assert.equal(store.cartSummary("alice").itemCount, 0);
  const next = store.planHikingBundle("alice", 150);
  assert.equal(next.items.some(i => i.productId === "p021"), false);
  assert.ok(next.projectedCart.total <= 150);
});
test("expired and repriced previews cannot be applied", t => {
  const { store, file } = fixture(t);
  const plan = store.planHikingBundle("alice");
  const db = new DatabaseSync(file);
  const product = store.getCatalog().find(p => p.id === "p003");
  db.prepare("UPDATE products SET data = ? WHERE id = ?").run(JSON.stringify({ ...product, price: 99 }), product.id);
  assert.throws(() => store.applyHikingBundle("alice", plan.bundleId), /price changed/);
  assert.equal(store.cartSummary("alice").itemCount, 0);
  const next = store.planHikingBundle("alice", 200);
  db.prepare("UPDATE bundles SET data = ? WHERE id = ?").run(JSON.stringify({ ...next, expiresAt: new Date(0).toISOString() }), next.bundleId);
  db.close();
  assert.equal(store.shopperState("alice").bundle, null);
  assert.throws(() => store.applyHikingBundle("alice", next.bundleId), /expired/);
});
