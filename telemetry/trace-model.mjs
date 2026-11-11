export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

export function spanCategory(span) {
  if (span.attributes?.["gen_ai.operation.name"] === "chat" || span.name.startsWith("chat ")) return "model";
  if (span.name.startsWith("store.") || span.name.startsWith("sqlite.")) return "store";
  if (span.name.startsWith("mcp.")) return "tool";
  return "request";
}

export function summarizeTrace(input) {
  const spans = [...new Map(input.map(span => [span.spanId, span])).values()].sort((a, b) => a.startTime - b.startTime);
  if (!spans.length) return null;
  const ids = new Set(spans.map(span => span.spanId));
  const roots = spans.filter(span => !ids.has(span.parentSpanId));
  const root = roots.find(span => span.name.startsWith("POST ") || span.name.startsWith("GET ")) || roots[0] || spans[0];
  const start = Math.min(...spans.map(span => span.startTime));
  const end = Math.max(...spans.map(span => span.startTime + Math.max(0, span.durationMs)));
  const models = spans.filter(span => spanCategory(span) === "model");
  const inputTokens = models.reduce((sum, span) => sum + (Number(span.attributes?.["gen_ai.usage.input_tokens"]) || 0), 0);
  const outputTokens = models.reduce((sum, span) => sum + (Number(span.attributes?.["gen_ai.usage.output_tokens"]) || 0), 0);
  return {
    id: root.traceId, spans, root, start, duration: Math.max(0, end - start), models,
    inputTokens, outputTokens, hasUsage: models.some(span => span.attributes?.["gen_ai.usage.input_tokens"] !== undefined || span.attributes?.["gen_ai.usage.output_tokens"] !== undefined),
    toolCount: spans.filter(span => span.name.startsWith("mcp.client ")).length,
    errors: spans.filter(span => span.status?.code === 2),
    services: new Set(spans.map(span => span.service)).size,
    hasContent: spans.some(span => span.events?.some(event => typeof event.attributes?.content === "string")),
  };
}

export function groupTraces(spans) {
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.traceId)) groups.set(span.traceId, []);
    groups.get(span.traceId).push(span);
  }
  return [...groups.values()].map(summarizeTrace).filter(Boolean).sort((a, b) => b.start - a.start);
}

export function flattenSpans(spans, collapsed = new Set()) {
  const byId = new Map(spans.map(span => [span.spanId, span]));
  const children = new Map();
  for (const span of byId.values()) {
    if (!children.has(span.parentSpanId)) children.set(span.parentSpanId, []);
    children.get(span.parentSpanId).push(span);
  }
  for (const items of children.values()) items.sort((a, b) => a.startTime - b.startTime);
  const rows = [], visited = new Set();
  function visit(span, depth) {
    if (visited.has(span.spanId)) return;
    visited.add(span.spanId);
    const nested = children.get(span.spanId) || [];
    rows.push({ span, depth, hasChildren: nested.length > 0 });
    if (collapsed.has(span.spanId)) {
      const mark = child => { if (visited.has(child.spanId)) return; visited.add(child.spanId); for (const item of children.get(child.spanId) || []) mark(item); };
      nested.forEach(mark);
    } else nested.forEach(child => visit(child, depth + 1));
  }
  for (const span of byId.values()) if (!byId.has(span.parentSpanId)) visit(span, 0);
  // Retained files can be partial or malformed. Do not lose orphaned/cyclic spans.
  for (const span of byId.values()) if (!visited.has(span.spanId)) visit(span, 0);
  return rows;
}

export function barGeometry(span, trace) {
  const duration = Math.max(1, trace.duration);
  const left = Math.min(100, Math.max(0, (span.startTime - trace.start) / duration * 100));
  return { left, width: Math.min(100 - left, Math.max(0, span.durationMs / duration * 100)) };
}
