import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../mcp-server/dist/store.js";
const address = "123 Test Street, Boston, MA 02110, US";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "agentshot-"));
  const file = join(directory, "store.sqlite");
  const connections = [];
  const open = () => { const s = new Store(file); connections.push(s); return s; };
  t.after(() => { for (const s of connections) { try { s.close(); } catch {} } rmSync(directory, { recursive: true, force: true }); });
  return { store: open(), open, file };
}
test("shopping flow saves cart, inventory and receipt across database restarts", t => {
  const { store, open } = fixture(t);
  const product = store.searchProducts({ query: "wireless headphones", maxPrice: 150 })[0];
  assert.equal(product.id, "p001");
  store.addToCart("alice", product.id, 2);
  store.close();
  const restarted = open();
  assert.equal(restarted.cartSummary("alice").itemCount, 2);
  const review = restarted.prepareCheckout("alice", address);
  assert.equal(review.total, 280.78);
  assert.equal(restarted.shopperState("alice").orders.length, 0);
  const order = restarted.confirmCheckout("alice", review.reviewId);
  assert.equal(order.status, "confirmed");
  restarted.close();
  const again = open();
  assert.equal(again.cartSummary("alice").itemCount, 0);
  assert.equal(again.getCatalog().find(p => p.id === product.id).stock, product.stock - 2);
  assert.deepEqual(again.shopperState("alice").orders[0], order);
  assert.deepEqual(again.confirmCheckout("alice", review.reviewId), order);
});
test("accumulated quantities and invalid quantities cannot exceed stock", t => {
  const { store } = fixture(t);
  store.addToCart("alice", "p003", 14);
  assert.throws(() => store.addToCart("alice", "p003", 2), /Only 15/);
  assert.equal(store.cartSummary("alice").itemCount, 14);
  for (const n of [0, -1, 1.5, NaN]) {
    assert.throws(() => store.addToCart("alice", "p003", n), /positive whole/);
    assert.throws(() => store.removeFromCart("alice", "p003", n), /positive whole/);
  }
  assert.throws(() => store.addToCart("alice", "p006", 1), /Only 0/);
});
test("checkout revalidates stock after another shopper purchases; failure is atomic", t => {
  const { store, open } = fixture(t);
  const other = open();
  store.addToCart("alice", "p003", 15);
  other.addToCart("bob", "p003", 15);
  other.addToCart("bob", "p004", 1);
  const alice = store.prepareCheckout("alice", address);
  const bob = other.prepareCheckout("bob", address);
  store.confirmCheckout("alice", alice.reviewId);
  assert.throws(() => other.confirmCheckout("bob", bob.reviewId), /Stock changed/);
  assert.equal(other.cartSummary("bob").itemCount, 16);
  assert.equal(other.getCatalog().find(p => p.id === "p004").stock, 200);
  assert.equal(other.shopperState("bob").orders.length, 0);
});
test("cart changes invalidate reviews; sessions cannot read or confirm each other's orders", t => {
  const { store } = fixture(t);
  store.addToCart("alice", "p001", 1);
  const review = store.prepareCheckout("alice", address);
  assert.equal(store.cartSummary("bob").itemCount, 0);
  assert.throws(() => store.confirmCheckout("bob", review.reviewId), /Review your cart/);
  store.addToCart("alice", "p002", 1);
  assert.equal(store.shopperState("alice").review, null);
  assert.throws(() => store.confirmCheckout("alice", review.reviewId), /Review your cart/);
  const current = store.prepareCheckout("alice", address);
  const order = store.confirmCheckout("alice", current.reviewId);
  store.addToCart("alice", "p004", 1);
  assert.deepEqual(store.confirmCheckout("alice", current.reviewId), order);
  assert.equal(store.cartSummary("alice").itemCount, 1);
  assert.equal(store.shopperState("bob").orders.length, 0);
});
test("empty carts, missing reviews, incomplete addresses and expired reviews are rejected", t => {
  const { store, file } = fixture(t);
  const initialStock = store.getCatalog().find(p => p.id === "p001").stock;
  assert.throws(() => store.prepareCheckout("alice", address), /empty cart/);
  assert.throws(() => store.confirmCheckout("alice", "unknown"), /Review your cart/);
  store.addToCart("alice", "p001", 1);
  assert.throws(() => store.prepareCheckout("alice", "abc"), /complete shipping/);
  const review = store.prepareCheckout("alice", address);
  const db = new DatabaseSync(file);
  db.prepare("UPDATE reviews SET data = ? WHERE id = ?").run(JSON.stringify({ ...review, expiresAt: new Date(0).toISOString() }), review.reviewId);
  db.close();
  assert.equal(store.shopperState("alice").review, null);
  assert.throws(() => store.confirmCheckout("alice", review.reviewId), /expired/);
  assert.equal(store.getCatalog().find(p => p.id === "p001").stock, initialStock);
});
