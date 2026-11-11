import { test } from "node:test";
import assert from "node:assert/strict";
import { barGeometry, flattenSpans, summarizeTrace } from "../telemetry/trace-model.mjs";
const span = (spanId, name, startTime, durationMs, parentSpanId, attributes = {}) => ({
  spanId, name, startTime, durationMs, parentSpanId, traceId: "fixture", service: "backend", status: { code: 0 }, attributes, events: [],
});
test("trace metrics count model usage and tool calls once across nested service spans", () => {
  const items = [
    span("root", "POST /api/chat", 1000, 10000),
    span("agent", "agent.turn", 1000, 10000, "root", { "gen_ai.usage.input_tokens": 9999 }),
    span("model1", "chat local", 1000, 4000, "agent", { "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 20 }),
    span("model2", "chat local", 5000, 6000, "agent", { "gen_ai.usage.input_tokens": 150, "gen_ai.usage.output_tokens": 30 }),
    span("tool-client", "mcp.client search_products", 4990, 10, "agent"),
    { ...span("tool-server", "mcp.server search_products", 4991, 8, "tool-client"), service: "mcp" },
  ];
  const result = summarizeTrace([...items, items[0]]);
  assert.equal(result.duration, 10000);
  assert.equal(result.models.length, 2);
  assert.equal(result.inputTokens, 250);
  assert.equal(result.outputTokens, 50);
  assert.equal(result.toolCount, 1);
  assert.equal(result.spans.length, 6);
  assert.equal(result.services, 2);
});
test("all waterfall bars use a shared clock rather than each parent's width", () => {
  const trace = { start: 1000, duration: 10000 };
  assert.deepEqual(barGeometry(span("child", "chat local", 3000, 4000, "parent"), trace), { left: 20, width: 40 });
  assert.deepEqual(barGeometry(span("late", "tool", 10000, 5000), trace), { left: 90, width: 10 });
});
test("hierarchy supports collapsing and preserves orphaned or cyclic retained spans", () => {
  const items = [
    span("root", "request", 0, 10),
    span("child", "model", 1, 8, "root"),
    span("grandchild", "tool", 2, 1, "child"),
    span("orphan", "store", 20, 1, "missing"),
  ];
  assert.deepEqual(flattenSpans(items).map(row => [row.span.spanId, row.depth]), [["root",0],["child",1],["grandchild",2],["orphan",0]]);
  assert.deepEqual(flattenSpans(items, new Set(["child"])).map(row => row.span.spanId), ["root","child","orphan"]);
  const cycle = [span("a","a",0,1,"b"),span("b","b",0,1,"a")];
  assert.equal(flattenSpans(cycle).length, 2);
});
