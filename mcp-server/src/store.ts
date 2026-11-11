import products from "./data/products.json" with { type: "json" };

export interface Product {
  id: string;
  name: string;
  category: string;
  tags: string[];
  price: number;
  rating: number;
  stock: number;
  description: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

const catalog = products as Product[];

// In-memory carts keyed by sessionId so multiple shoppers don't collide.
const carts = new Map<string, CartItem[]>();

function getCart(sessionId: string): CartItem[] {
  if (!carts.has(sessionId)) carts.set(sessionId, []);
  return carts.get(sessionId)!;
}

export function getCatalog(): Product[] {
  return catalog;
}

export function findProduct(productId: string): Product | undefined {
  return catalog.find((p) => p.id === productId);
}

export function searchProducts(opts: {
  query?: string;
  category?: string;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
}): Product[] {
  const q = opts.query?.toLowerCase().trim();
  return catalog.filter((p) => {
    if (q) {
      const haystack = `${p.name} ${p.description} ${p.tags.join(" ")} ${p.category}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (opts.category && p.category.toLowerCase() !== opts.category.toLowerCase()) return false;
    if (opts.maxPrice !== undefined && p.price > opts.maxPrice) return false;
    if (opts.minRating !== undefined && p.rating < opts.minRating) return false;
    if (opts.inStockOnly && p.stock <= 0) return false;
    return true;
  });
}

export function recommendProducts(opts: {
  basedOnProductId?: string;
  category?: string;
  limit?: number;
}): Product[] {
  const limit = opts.limit ?? 4;
  let pool = catalog.filter((p) => p.stock > 0);

  if (opts.basedOnProductId) {
    const base = findProduct(opts.basedOnProductId);
    if (base) {
      pool = pool.filter((p) => p.id !== base.id);
      const scored = pool.map((p) => {
        const sharedTags = p.tags.filter((t) => base.tags.includes(t)).length;
        const sameCategory = p.category === base.category ? 1 : 0;
        return { p, score: sharedTags * 2 + sameCategory };
      });
      scored.sort((a, b) => b.score - a.score || b.p.rating - a.p.rating);
      return scored.slice(0, limit).map((s) => s.p);
    }
  }

  if (opts.category) {
    pool = pool.filter((p) => p.category.toLowerCase() === opts.category!.toLowerCase());
  }

  pool = [...pool].sort((a, b) => b.rating - a.rating);
  return pool.slice(0, limit);
}

export function addToCart(sessionId: string, productId: string, quantity: number) {
  const product = findProduct(productId);
  if (!product) throw new Error(`Unknown product id: ${productId}`);
  if (product.stock < quantity) {
    throw new Error(`Only ${product.stock} unit(s) of "${product.name}" in stock.`);
  }
  const cart = getCart(sessionId);
  const existing = cart.find((i) => i.productId === productId);
  if (existing) existing.quantity += quantity;
  else cart.push({ productId, quantity });
  return cartSummary(sessionId);
}

export function removeFromCart(sessionId: string, productId: string, quantity?: number) {
  const cart = getCart(sessionId);
  const idx = cart.findIndex((i) => i.productId === productId);
  if (idx === -1) throw new Error(`Product ${productId} is not in the cart.`);
  if (quantity === undefined || cart[idx].quantity <= quantity) {
    cart.splice(idx, 1);
  } else {
    cart[idx].quantity -= quantity;
  }
  return cartSummary(sessionId);
}

export function cartSummary(sessionId: string) {
  const cart = getCart(sessionId);
  const items = cart.map((i) => {
    const product = findProduct(i.productId)!;
    return {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: i.quantity,
      lineTotal: Math.round(product.price * i.quantity * 100) / 100,
    };
  });
  const subtotal = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  return { items, subtotal, itemCount: items.reduce((n, i) => n + i.quantity, 0) };
}

export function checkout(sessionId: string, shippingAddress: string) {
  const summary = cartSummary(sessionId);
  if (summary.items.length === 0) throw new Error("Cannot checkout with an empty cart.");

  // Deduct stock and clear cart to simulate order placement.
  const cart = getCart(sessionId);
  for (const item of cart) {
    const product = findProduct(item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.quantity);
  }
  carts.set(sessionId, []);

  const tax = Math.round(summary.subtotal * 0.08 * 100) / 100;
  const total = Math.round((summary.subtotal + tax) * 100) / 100;
  const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
  return {
    orderId,
    shippingAddress,
    items: summary.items,
    subtotal: summary.subtotal,
    tax,
    total,
    status: "confirmed",
  };
}
