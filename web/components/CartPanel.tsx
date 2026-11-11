"use client";
import { useEffect, useState } from "react";
import { Cart, money, ShopperState } from "../lib/api";
function Totals({ cart }: { cart: Cart }) {
  return <dl className="totals"><div><dt>Subtotal</dt><dd>{money(cart.subtotal)}</dd></div><div><dt>Demo tax (8%)</dt><dd>{money(cart.tax)}</dd></div><div><dt>Shipping</dt><dd>Free · simulated</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(cart.total)}</dd></div></dl>;
}
export default function CartPanel({ state, busy, onAction }: {
  state: ShopperState | null; busy: boolean;
  onAction: (path: string, body: unknown, success: string) => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  useEffect(() => { if (state?.review) setAddress(state.review.shippingAddress); }, [state?.review?.reviewId]);
  if (!state) return <section className="panel cart-panel"><h2>Your cart</h2><p className="muted">Loading your cart…</p></section>;
  const { cart, review, orders } = state;
  const reviewing = !!review && review.shippingAddress === address.trim();
  return <section className="panel cart-panel" aria-labelledby="cart-heading">
    <div className="section-heading"><h2 id="cart-heading">Your cart</h2><span className="count">{cart.itemCount}</span></div>
    {!cart.items.length ? <p className="empty">Something good belongs here. Add a find from the collection or ask the assistant.</p> : <>
      <ul className="cart-items">{cart.items.map(item => <li key={item.productId}>
        <div className="cart-line"><strong>{item.name}</strong><span>{money(item.lineTotal)}</span></div>
        <div className="cart-line"><span className="muted">{money(item.unitPrice)} each</span><div className="quantity">
          <button aria-label={`Remove one ${item.name}`} disabled={busy} onClick={() => onAction("/cart", { productId: item.productId, quantity: 1, operation: "remove" }, "Cart updated.")}>−</button>
          <span aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
          <button aria-label={`Add one ${item.name}`} disabled={busy} onClick={() => onAction("/cart", { productId: item.productId }, "Cart updated.")}>+</button>
        </div></div>
      </li>)}</ul>
      <Totals cart={reviewing ? review! : cart} />
      <form onSubmit={e => { e.preventDefault(); onAction("/checkout/review", { shippingAddress: address }, "Review ready. Confirm below when everything looks right."); }}>
        <label htmlFor="shipping">Shipping address</label>
        <textarea id="shipping" value={address} onChange={e => setAddress(e.target.value)} required minLength={10} maxLength={1000} disabled={busy} placeholder="Street, city, state, postal code and country" autoComplete="street-address" />
        {!reviewing && <button className="primary full" disabled={busy}>{busy ? "Updating…" : "Review checkout →"}</button>}
      </form>
      {reviewing && <div className="checkout-review">
        <p className="eyebrow">Ready for your review</p>
        <h3>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} · {money(review!.total)}</h3>
        <p className="address">{review!.shippingAddress}</p>
        <p className="muted">Confirm the items, total and address above. This places a demo order; no payment is taken.</p>
        <button className="primary full" disabled={busy} onClick={() => onAction("/checkout/confirm", { reviewId: review!.reviewId, confirmed: true }, "Demo order confirmed. Your receipt is saved below.")}>{busy ? "Confirming…" : "Confirm demo order"}</button>
      </div>}
    </>}
    {!!orders.length && <div className="order-history"><h3>Saved orders</h3>{orders.map(order => <details className="order" key={order.orderId}>
      <summary><span><span className="order-status">Confirmed</span> · {new Date(order.createdAt).toLocaleDateString()}</span><strong>{money(order.total)}</strong></summary>
      <p className="order-id">{order.orderId}</p><p className="address">{order.shippingAddress}</p>
      <ul>{order.items.map(item => <li key={item.productId}>{item.quantity} × {item.name} <strong>{money(item.lineTotal)}</strong></li>)}</ul>
      <Totals cart={order} />
    </details>)}</div>}
  </section>;
}
