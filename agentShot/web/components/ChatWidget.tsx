"use client";

import { useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Role = "user" | "assistant" | "tool";
interface ChatMessage {
  role: Role;
  text: string;
}

function makeSessionId() {
  return `session_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export default function ChatWidget() {
  const sessionIdRef = useRef<string>(makeSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi! I'm your AgentShot shopping assistant. Ask me to find products, get recommendations, add things to your cart, or check out.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const toolMsgs: ChatMessage[] = (data.toolCalls || []).map((tc: any) => ({
        role: "tool" as const,
        text: `🔧 ${tc.name}(${JSON.stringify(tc.input)})`,
      }));
      setMessages((prev) => [...prev, ...toolMsgs, { role: "assistant", text: data.reply }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">Shopping Assistant</div>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            {m.text}
          </div>
        ))}
        {loading && <div className="msg assistant">Thinking…</div>}
      </div>
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. Find me running shoes under $120"
          disabled={loading}
        />
        <button onClick={send} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}
