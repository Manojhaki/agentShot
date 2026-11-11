import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import seed from "./data/products.json" with { type: "json" };

export interface Product { id: string; name: string; category: string; tags: string[]; price: number; rating: number; stock: number; description: string }
interface Line { productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }
export interface Review { reviewId: string; shippingAddress: string; items: Line[]; subtotal: number; tax: number; total: number; itemCount: number; expiresAt: string }
export interface Order extends Review { orderId: string; createdAt: string; status: "confirmed" }
const money = (n: number) => Math.round(n * 100) / 100;
function quantity(n: number) { if (!Number.isSafeInteger(n) || n < 1) throw new Error("Quantity must be a positive whole number."); }

export class Store {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0));
      CREATE TABLE IF NOT EXISTS carts (session TEXT, product TEXT, quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(session, product));
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, session TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, session TEXT NOT NULL, review TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS orders_session ON orders(session);
      CREATE INDEX IF NOT EXISTS reviews_session ON reviews(session);`);
    const insert = this.db.prepare("INSERT OR IGNORE INTO products VALUES (?, ?, ?)");
    for (const p of seed) insert.run(p.id, JSON.stringify(p), p.stock);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  getCatalog(): Product[] {
    return this.db.prepare("SELECT data, stock FROM products ORDER BY id").all().map(row => ({
      ...JSON.parse(row.data as string), stock: Number(row.stock),
    }));
  }
  searchProducts(opts: { query?: string; category?: string; maxPrice?: number; minRating?: number; inStockOnly?: boolean }) {
    const words = opts.query?.toLowerCase().trim().split(/\s+/).filter(Boolean) ?? [];
    return this.getCatalog().filter(p => {
      const text = `${p.name} ${p.description} ${p.tags.join(" ")} ${p.category}`.toLowerCase();
      return words.every(word => text.includes(word)) &&
        (!opts.category || p.category.toLowerCase() === opts.category.toLowerCase()) &&
        (opts.maxPrice === undefined || p.price <= opts.maxPrice) &&
        (opts.minRating === undefined || p.rating >= opts.minRating) && (!opts.inStockOnly || p.stock > 0);
    });
  }
  recommendProducts(opts: { basedOnProductId?: string; category?: string; limit?: number }) {
    const catalog = this.getCatalog();
    const base = catalog.find(p => p.id === opts.basedOnProductId);
    const score = (p: Product) => base ? p.tags.filter(t => base.tags.includes(t)).length * 2 + Number(p.category === base.category) : 0;
    return catalog.filter(p => p.stock > 0 && p.id !== base?.id && (!opts.category || p.category === opts.category))
      .sort((a, b) => score(b) - score(a) || b.rating - a.rating).slice(0, opts.limit ?? 4);
  }
  cartSummary(session: string) {
    const rows = this.db.prepare("SELECT product, quantity FROM carts WHERE session = ? ORDER BY product").all(session);
    const catalog = this.getCatalog();
    const items: Line[] = rows.map(row => {
      const p = catalog.find(p => p.id === row.product)!;
      return { productId: p.id, name: p.name, unitPrice: p.price, quantity: Number(row.quantity), lineTotal: money(p.price * Number(row.quantity)) };
    });
    const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const tax = money(subtotal * 0.08);
    return { items, subtotal, tax, total: money(subtotal + tax), itemCount: items.reduce((n, i) => n + i.quantity, 0) };
  }
  addToCart(session: string, productId: string, count: number) {
    quantity(count);
    return this.transaction(() => {
      const p = this.getCatalog().find(p => p.id === productId);
      if (!p) throw new Error(`Unknown product id: ${productId}`);
      const current = this.cartSummary(session).items.find(i => i.productId === productId)?.quantity ?? 0;
      if (current + count > p.stock) throw new Error(`Only ${p.stock} unit(s) of "${p.name}" available, including items already in your cart.`);
      this.db.prepare("INSERT INTO carts VALUES (?, ?, ?) ON CONFLICT(session, product) DO UPDATE SET quantity = excluded.quantity").run(session, productId, current + count);
      this.db.prepare("DELETE FROM reviews WHERE session = ?").run(session);
      return this.cartSummary(session);
    });
  }
  removeFromCart(session: string, productId: string, count?: number) {
    if (count !== undefined) quantity(count);
    return this.transaction(() => {
      const item = this.cartSummary(session).items.find(i => i.productId === productId);
      if (!item) throw new Error("This product is not in your cart.");
      if (count === undefined || count >= item.quantity) this.db.prepare("DELETE FROM carts WHERE session = ? AND product = ?").run(session, productId);
      else this.db.prepare("UPDATE carts SET quantity = quantity - ? WHERE session = ? AND product = ?").run(count, session, productId);
      this.db.prepare("DELETE FROM reviews WHERE session = ?").run(session);
      return this.cartSummary(session);
    });
  }
  private validateStock(items: Line[]) {
    const catalog = this.getCatalog();
    for (const item of items) {
      if ((catalog.find(p => p.id === item.productId)?.stock ?? 0) < item.quantity)
        throw new Error(`Stock changed for "${item.name}". Update your cart and review again.`);
    }
  }
  prepareCheckout(session: string, shippingAddress: string): Review {
    if (typeof shippingAddress !== "string" || shippingAddress.trim().length < 10 || shippingAddress.length > 1000)
      throw new Error("Enter a complete shipping address (10-1000 characters).");
    return this.transaction(() => {
      const summary = this.cartSummary(session);
      if (!summary.items.length) throw new Error("Cannot checkout with an empty cart.");
      this.validateStock(summary.items);
      const review: Review = { ...summary, reviewId: randomUUID(), shippingAddress: shippingAddress.trim(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
      this.db.prepare("DELETE FROM reviews WHERE session = ?").run(session);
      this.db.prepare("INSERT INTO reviews VALUES (?, ?, ?, ?)").run(review.reviewId, session, JSON.stringify(summary), JSON.stringify(review));
      return review;
    });
  }
  confirmCheckout(session: string, reviewId: string): Order {
    return this.transaction(() => {
      // The review is also the idempotency key: retries return the same saved order.
      const saved = this.db.prepare("SELECT data FROM orders WHERE session = ? AND review = ?").get(session, reviewId);
      if (saved) return JSON.parse(saved.data as string);
      const row = this.db.prepare("SELECT * FROM reviews WHERE id = ? AND session = ?").get(reviewId, session);
      if (!row) throw new Error("Review your cart before confirming the order.");
      const review: Review = JSON.parse(row.data as string);
      if (Date.parse(review.expiresAt) <= Date.now()) throw new Error("This review expired. Review your cart again.");
      if (row.fingerprint !== JSON.stringify(this.cartSummary(session))) throw new Error("Your cart changed. Review it again.");
      this.validateStock(review.items);
      const order: Order = { ...review, orderId: `ORD-${randomUUID().toUpperCase()}`, createdAt: new Date().toISOString(), status: "confirmed" };
      for (const item of review.items) this.db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(item.quantity, item.productId);
      this.db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?)").run(order.orderId, session, reviewId, JSON.stringify(order));
      this.db.prepare("DELETE FROM carts WHERE session = ?").run(session);
      this.db.prepare("DELETE FROM reviews WHERE session = ?").run(session);
      return order;
    });
  }
  shopperState(session: string) {
    const row = this.db.prepare("SELECT data FROM reviews WHERE session = ?").get(session);
    const review: Review | null = row ? JSON.parse(row.data as string) : null;
    return {
      cart: this.cartSummary(session), review: review && Date.parse(review.expiresAt) > Date.now() ? review : null,
      orders: this.db.prepare("SELECT data FROM orders WHERE session = ? ORDER BY rowid DESC LIMIT 20").all(session).map(r => JSON.parse(r.data as string) as Order),
    };
  }
}
let instance: Store;
function store() { return instance ??= new Store(process.env.AGENTSHOT_DB_PATH ?? fileURLToPath(new URL("../data/agentshot.sqlite", import.meta.url))); }
export const searchProducts = (opts: Parameters<Store["searchProducts"]>[0]) => store().searchProducts(opts);
export const recommendProducts = (opts: Parameters<Store["recommendProducts"]>[0]) => store().recommendProducts(opts);
export const addToCart = (s: string, p: string, n: number) => store().addToCart(s, p, n);
export const removeFromCart = (s: string, p: string, n?: number) => store().removeFromCart(s, p, n);
export const cartSummary = (s: string) => store().cartSummary(s);
export const prepareCheckout = (s: string, a: string) => store().prepareCheckout(s, a);
export const confirmCheckout = (s: string, r: string) => store().confirmCheckout(s, r);
export const shopperState = (s: string) => store().shopperState(s);
