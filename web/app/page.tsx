"use client";
import { useCallback, useEffect, useState } from "react";
import ProductGrid from "../components/ProductGrid";
import ChatWidget from "../components/ChatWidget";
import CartPanel from "../components/CartPanel";
import HikingBundlePanel from "../components/HikingBundlePanel";
import { api, Product, ShopperState } from "../lib/api";
import "./globals.css";

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<ShopperState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    // Establish the session cookie before making additional requests.
    const next = await api<ShopperState>("/state");
    setState(next);
    setProducts(await api<Product[]>("/products"));
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  async function mutate(path: string, body: unknown, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await api(path, body); await refresh(); setNotice(success); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const add = (productId: string) => mutate("/cart", { productId }, "Added to your cart.");
  return <main className="page">
    <header className="header">
      <a className="brand" href="/">AgentShot<span className="brand-dot" /></a>
      <span className="demo-badge">Demo store · No real payments</span>
    </header>
    <section className="intro">
      <p className="eyebrow">A little help finding your next favorite.</p>
      <h1>Good finds. Less searching.</h1>
      <p>Explore the collection or ask your shopping assistant. Your cart stays with you.</p>
    </section>
    {error && <div className="banner error" role="alert">{error} <button className="text-button" onClick={() => { setError(""); refresh().catch(e => setError(e.message)); }}>Refresh store</button></div>}
    <div className="notice" role="status">{notice}</div>
    <div className="layout">
      <section aria-labelledby="collection-title">
        <HikingBundlePanel state={state} busy={busy} onAction={mutate} />
        <div className="section-heading"><h2 id="collection-title">The collection</h2><span>{products.length} thoughtful essentials</span></div>
        {!state && !error ? <p role="status">Opening your store…</p> : <ProductGrid products={products} onAdd={add} disabled={busy || !state} />}
      </section>
      <aside className="sidebar">
        <ChatWidget disabled={busy || !state} onBusy={setBusy} onChange={refresh} onAdd={add} />
        <CartPanel state={state} busy={busy} onAction={mutate} />
      </aside>
    </div>
    <footer>AgentShot · A local shopping demo powered by MCP. Shipping is simulated; tax is a demo flat 8%.</footer>
  </main>;
}
