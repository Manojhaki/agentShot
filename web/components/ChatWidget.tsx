"use client";
import { useEffect, useRef, useState } from "react";
import { api, money, Product, ToolCall } from "../lib/api";
interface Message { role: "user" | "assistant"; text: string; tools?: ToolCall[]; products?: Product[] }
const greeting: Message = { role: "assistant", text: "Hi, what are you looking for? I can find a good match, build your cart, and help you get ready to check out." };
export default function ChatWidget({ disabled, onBusy, onChange, onAdd }: {
  disabled: boolean; onBusy: (busy: boolean) => void; onChange: () => Promise<void>; onAdd: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages, loading]);
  async function send(text = input.trim()) {
    if (!text || disabled || loading) return;
    setInput(""); setError(""); setLoading(true); onBusy(true);
    setMessages(prev => [...prev, { role: "user", text }]);
    try {
      const data = await api<{ reply: string; toolCalls: ToolCall[] }>("/chat", { message: text });
      const products = new Map<string, Product>();
      for (const tool of data.toolCalls) {
        if (!tool.isError && ["search_products", "get_recommendations"].includes(tool.name)) {
          try { for (const p of JSON.parse(tool.output) as Product[]) products.set(p.id, p); } catch { /* Tool output remains available in details. */ }
        }
      }
      setMessages(prev => [...prev, { role: "assistant", text: data.reply, tools: data.toolCalls, products: [...products.values()].slice(0, 4) }]);
    } catch (e) { setError((e as Error).message); setInput(text); }
    finally {
      try { await onChange(); } catch { setError("Couldn't refresh your cart. Refresh the store to see the latest changes."); }
      setLoading(false); onBusy(false);
    }
  }
  async function reset() {
    onBusy(true); setError("");
    try { await api("/chat/reset", {}); setMessages([greeting]); }
    catch (e) { setError((e as Error).message); }
    finally { onBusy(false); }
  }
  return <section className="panel chat-panel" aria-labelledby="assistant-heading">
    <div className="chat-header"><div><span className="assistant-mark" aria-hidden="true">✧</span><h2 id="assistant-heading">Your shopping assistant</h2></div><button className="text-button" onClick={reset} disabled={disabled}>New chat</button></div>
    <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-busy={loading}>
      {messages.map((m, i) => <div className={`message-group ${m.role}`} key={i}>
        <div className={`msg ${m.role}`}>{m.text}</div>
        {!!m.products?.length && <div className="chat-products">{m.products.map(p => <article className="chat-product" key={p.id}>
          <strong>{p.name}</strong><div><span>{money(p.price)}</span><button className="text-button" disabled={disabled || !p.stock} onClick={() => onAdd(p.id)}>{p.stock ? "Add +" : "Sold out"}</button></div>
        </article>)}</div>}
        {!!m.tools?.length && <details className="tool-details"><summary>Behind the scenes · {m.tools.length} action{m.tools.length === 1 ? "" : "s"}</summary>{m.tools.map((t, j) => <div key={j}><strong>{t.name} {t.isError ? "· Failed" : "· Done"}</strong><pre>{JSON.stringify(t.input, null, 2)}{"\n"}{t.output}</pre></div>)}</details>}
      </div>)}
      {loading && <div className="msg assistant" role="status">Finding the details…</div>}
      <div ref={end} />
    </div>
    {messages.length === 1 && <div className="suggestions">{["Headphones under $150", "Build a hiking bundle under $150", "What's in my cart?"].map(text => <button key={text} disabled={disabled} onClick={() => send(text)}>{text}</button>)}</div>}
    {error && <p className="chat-error" role="alert">{error}</p>}
    <form className="chat-input" onSubmit={e => { e.preventDefault(); send(); }}>
      <label className="sr-only" htmlFor="chat-message">Message the shopping assistant</label>
      <input id="chat-message" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about a product…" maxLength={4000} disabled={disabled} />
      <button className="primary" disabled={disabled || !input.trim()} aria-label="Send message">Send</button>
    </form>
  </section>;
}
