import type { CartSummary, Line, Product } from "./store.js";

export interface HikingBundle {
  bundleId: string;
  budget: number;
  items: (Line & { reason: string })[];
  projectedCart: CartSummary;
  additionalTotal: number;
  expiresAt: string;
}

// Explicit demo priorities keep selection reproducible and prices authoritative.
// This is a shopping starter bundle, not a complete hiking equipment checklist.
const candidates = [
  { id: "p003", weight: 40, reason: "Carry your gear in a 35L backpack." },
  { id: "p004", weight: 30, reason: "Bring a reusable bottle for your water." },
  { id: "p021", weight: 25, reason: "Pack supplies for minor scrapes." },
  { id: "p019", weight: 12, reason: "Add a packable layer for unexpected rain." },
  { id: "p016", weight: 8, reason: "Add adjustable poles for trail support." },
  { id: "p023", weight: 6, reason: "Help keep small essentials dry." },
  { id: "p036", weight: 4, reason: "Add a fleece layer for a chilly walk." },
  { id: "p013", weight: 3, reason: "Carry backup power for your devices." },
];

export function buildHikingPlan(catalog: Product[], cart: CartSummary, budget: number) {
  if (!Number.isFinite(budget) || budget < 1 || budget > 10_000 || Math.abs(budget * 100 - Math.round(budget * 100)) > 0.00001)
    throw new Error("Enter a budget between $1 and $10,000, with at most two decimal places.");
  if (cart.total >= budget) throw new Error("Your current cart already uses this budget. Increase it or remove an item first.");
  const available = candidates.flatMap(candidate => {
    const product = catalog.find(p => p.id === candidate.id);
    return product && product.stock > 0 && !cart.items.some(i => i.productId === product.id) ? [{ ...candidate, product }] : [];
  });
  let best: { selected: typeof available; score: number; subtotal: number; tax: number; total: number } | null = null;
  const existingCents = Math.round(cart.subtotal * 100);
  for (let mask = 1; mask < 2 ** available.length; mask++) {
    const selected = available.filter((_, i) => mask & (1 << i));
    const cents = existingCents + selected.reduce((sum, item) => sum + Math.round(item.product.price * 100), 0);
    const taxCents = Math.round(cents * 0.08);
    const total = (cents + taxCents) / 100;
    const score = selected.reduce((sum, item) => sum + item.weight, 0);
    if (total <= budget && (!best || score > best.score || (score === best.score && total < best.total)))
      best = { selected, score, subtotal: cents / 100, tax: taxCents / 100, total };
  }
  if (!best) throw new Error("No additional hiking picks fit the remaining budget. Increase the budget or remove an item from your cart.");
  const items = best.selected.map(({ product: p, reason }) => ({ productId: p.id, name: p.name, unitPrice: p.price, quantity: 1, lineTotal: p.price, reason }));
  return {
    budget, items,
    projectedCart: { items: [...cart.items, ...items], subtotal: best.subtotal, tax: best.tax, total: best.total, itemCount: cart.itemCount + items.length },
    additionalTotal: Math.round((best.total - cart.total) * 100) / 100,
  };
}
