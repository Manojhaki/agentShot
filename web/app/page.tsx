"use client";

import { useEffect, useState } from "react";
import "./globals.css";
import ProductGrid from "../components/ProductGrid";
import ChatWidget from "../components/ChatWidget";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/products`)
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  return (
    <main className="page">
      <div className="header">
        <h1>🛍️ AgentShot</h1>
        <span>Agentic ecommerce demo · MCP-powered</span>
      </div>
      <div className="layout">
        <ProductGrid products={products} />
        <ChatWidget />
      </div>
    </main>
  );
}
