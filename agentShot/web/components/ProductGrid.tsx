"use client";

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  rating: number;
  stock: number;
  description: string;
}

export default function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return <p>Loading products…</p>;
  }
  return (
    <div className="product-grid">
      {products.map((p) => (
        <div className="product-card" key={p.id}>
          <span className="badge">{p.category}</span>
          <h3>{p.name}</h3>
          <p className="desc">{p.description}</p>
          <div className="meta">
            <span>${p.price.toFixed(2)}</span>
            <span>★ {p.rating.toFixed(1)}</span>
          </div>
          <div className="meta">
            <span>{p.stock > 0 ? `${p.stock} in stock` : <span className="out-of-stock">Out of stock</span>}</span>
            <span style={{ opacity: 0.5 }}>{p.id}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
