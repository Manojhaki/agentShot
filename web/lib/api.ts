export interface Product { id: string; name: string; category: string; price: number; rating: number; stock: number; description: string }
export interface Line { productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }
export interface Cart { items: Line[]; subtotal: number; tax: number; total: number; itemCount: number }
export interface Review extends Cart { reviewId: string; shippingAddress: string; expiresAt: string }
export interface Order extends Review { orderId: string; createdAt: string; status: string }
export interface HikingBundle { bundleId: string; budget: number; items: (Line & { reason: string })[]; projectedCart: Cart; additionalTotal: number; expiresAt: string }
export interface ShopperState { cart: Cart; review: Review | null; orders: Order[]; bundle: HikingBundle | null }
export interface ToolCall { name: string; input: unknown; output: string; isError: boolean }
export const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    credentials: "include", cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data as T;
}
