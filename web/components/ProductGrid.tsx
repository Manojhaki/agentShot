"use client";
import { money, Product } from "../lib/api";
const symbols: Record<string, string> = { electronics: "↗", outdoors: "△", home: "◒", apparel: "≈" };
export default function ProductGrid({ products, onAdd, disabled }: { products: Product[]; onAdd: (id: string) => void; disabled: boolean }) {
  if (!products.length) return <p className="empty">No products to show. Refresh the store to try again.</p>;
  return <div className="product-grid">{products.map(p => <article className="product-card" key={p.id}>
    <div className={`product-art ${p.category}`} aria-hidden="true"><span>{symbols[p.category] || "✧"}</span><small>{p.category}</small></div>
    <div className="product-content">
      <div className="product-rating"><span>{p.category}</span><span aria-label={`Rated ${p.rating} out of 5`}>★ {p.rating.toFixed(1)}</span></div>
      <h3>{p.name}</h3><p className="desc">{p.description}</p>
      <div className="product-bottom"><strong>{money(p.price)}</strong><span className={p.stock ? "stock" : "out-of-stock"}>{p.stock ? `${p.stock} available` : "Sold out"}</span></div>
      <button className="secondary full" disabled={disabled || !p.stock} onClick={() => onAdd(p.id)}>{p.stock ? "Add to cart +" : "Out of stock"}</button>
    </div>
  </article>)}</div>;
}
