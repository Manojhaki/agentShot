import { activityLabel, recentActivities, barGeometry, flattenSpans, formatDuration, groupTraces, spanCategory } from "/trace-model.mjs";

const $ = selector => document.querySelector(selector);
const state = {
  traces: [], selectedTrace: new URL(location.href).searchParams.get("traceId"),
  selectedSpan: null, tab: "Summary", collapsed: new Set(),
  chatOnly: false, errorsOnly: false, rawSignature: "", detailSignature: "",
  requestNodes: new Map(), loading: false, inspectorSignature: "", latestUpdate: null,
};
const number = value => new Intl.NumberFormat("en-US").format(value);
const categoryLabel = { model: "Model", tool: "MCP tool", store: "Store", request: "Request / agent" };
const eventLabels = {
  "agent.tool.selected": "Selected a tool", "agent.tool.result": "Tool returned",
  "gen_ai.reasoning": "Model-reported thinking", "agent.user_message": "Shopper message",
  "agent.reply": "Assistant reply", "gen_ai.input.messages": "Model input",
  "gen_ai.output.message": "Model output", "mcp.tool.input": "Tool input", "mcp.tool.output": "Tool output",
  "exception": "Operation error",
};
const svgPaths = {
  copy: "M7 6V3h10v11h-3M3 6h11v11H3z",
  arrow: "m7 4 6 6-6 6",
  check: "m4 10 4 4 8-8",
  error: "m6 6 8 8M14 6l-8 8",
};
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20"); svg.setAttribute("fill", "none"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", svgPaths[name]); path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
  svg.append(path); return svg;
}
function announce(message) { $("#announcement").textContent = message; }
function currentTrace() { return state.traces.find(trace => trace.id === state.selectedTrace); }
function currentSpan() { return currentTrace()?.spans.find(span => span.spanId === state.selectedSpan); }
function filteredTraces() {
  const query = $("#search").value.trim().toLowerCase();
  return state.traces.filter(trace =>
    (!state.chatOnly || trace.spans.some(span => span.name === "agent.turn")) &&
    (!state.errorsOnly || trace.errors.length) &&
    (!query || trace.spans.some(span => (activityLabel(trace) + " " + span.name + " " + span.service + " " + trace.id).toLowerCase().includes(query)))
  );
}
function selectTrace(id, focus = false) {
  const trace = state.traces.find(item => item.id === id);
  if (!trace) return;
  const changed = state.selectedTrace !== id;
  state.selectedTrace = id;
  if (changed || !state.selectedSpan || !trace.spans.some(span => span.spanId === state.selectedSpan)) {
    state.selectedSpan = [...trace.models].sort((a, b) => b.durationMs - a.durationMs)[0]?.spanId || trace.errors[0]?.spanId || trace.root.spanId;
    state.tab = "Summary"; state.collapsed.clear();
  }
  history.replaceState(null, "", "?traceId=" + id);
  state.detailSignature = ""; state.inspectorSignature = "";
  renderRequests(); renderDetail();
  if (focus) state.requestNodes.get(id)?.focus();
}
function renderRequests() {
  const visible = filteredTraces();
  $("#trace-count").textContent = number(visible.length);
  const list = $("#trace-list"), wanted = new Set(visible.map(trace => trace.id));
  for (const [id, button] of state.requestNodes) {
    if (!wanted.has(id)) { button.remove(); state.requestNodes.delete(id); }
  }
  list.querySelector(".empty-state")?.remove();
  if (!visible.length) {
    const empty = node("p", $("#search").value || state.errorsOnly ? "No matching requests. Try another filter." : "Your next chat request will appear here. Open the storefront to get started.", "empty-state");
    list.append(empty); return;
  }
  visible.forEach((trace, index) => {
    let button = state.requestNodes.get(trace.id);
    if (!button) {
      button = node("button", undefined, "trace-button");
      button.type = "button";
      button.onclick = () => selectTrace(trace.id);
      button.onkeydown = event => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        const items = filteredTraces(), position = items.findIndex(item => item.id === trace.id);
        const next = items[position + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) { event.preventDefault(); selectTrace(next.id, true); }
      };
      state.requestNodes.set(trace.id, button);
    }
    const signature = [trace.id, trace.duration, trace.spans.length, trace.errors.length, state.selectedTrace].join("|");
    if (button.dataset.signature !== signature) {
      button.dataset.signature = signature;
      button.classList.toggle("selected", trace.id === state.selectedTrace);
      button.setAttribute("aria-current", trace.id === state.selectedTrace ? "true" : "false");
      button.setAttribute("aria-label", trace.root.name + ", " + formatDuration(trace.duration) + ", " + trace.spans.length + " spans" + (trace.errors.length ? ", errors recorded" : ""));
      const route = node("span", undefined, "trace-route");
      route.append(node("span", activityLabel(trace), "route-text"), node("span", undefined, "trace-dot" + (trace.errors.length ? " error" : "")));
      const meta = node("span", undefined, "trace-meta");
      meta.append(node("span", new Date(trace.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })), node("span", formatDuration(trace.duration)));
      button.replaceChildren(route, meta, node("span", trace.id.slice(0, 12) + "… · " + trace.spans.length + " spans", "trace-short-id"));
    }
    if (list.children[index] !== button) list.insertBefore(button, list.children[index] || null);
  });
}
function renderActivities() {
  const buttons = recentActivities(state.traces).map(trace => {
    const button = node("button", undefined, "activity-button");
    button.type = "button";
    button.append(node("strong", activityLabel(trace)), node("span", new Date(trace.start + trace.duration).toLocaleString() + " · " + formatDuration(trace.duration)), node("code", trace.id.slice(0, 12) + "…"));
    button.onclick = () => {
      state.chatOnly = false; state.errorsOnly = false; $("#search").value = "";
      $("#chat-only").setAttribute("aria-pressed", "false"); $("#errors-only").setAttribute("aria-pressed", "false");
      selectTrace(trace.id); $("#trace-summary").scrollIntoView({ block: "nearest" });
    };
    return button;
  });
  $("#activity-list").replaceChildren(...(buttons.length ? buttons : [node("p", "Shopping and chat activities will appear here as requests finish.", "empty-state")]));
}
async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const original = button.getAttribute("aria-label");
    button.setAttribute("aria-label", "Copied"); button.title = "Copied";
    button.replaceChildren(icon("check"));
    announce("Trace ID copied");
    setTimeout(() => { button.setAttribute("aria-label", original); button.title = original; button.replaceChildren(icon("copy")); }, 1800);
  } catch { announce("Could not copy. Select the trace ID to copy it manually."); }
}
function renderSummary(trace) {
  const card = node("section", undefined, "trace-summary");
  card.setAttribute("aria-label", "Request summary");
  const heading = node("div", undefined, "summary-title"), route = node("div", undefined, "summary-route");
  const parts = trace.root.name.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS) (.*)$/);
  if (parts) route.append(node("span", parts[1], "method-chip"));
  route.append(node("h3", parts ? parts[2] : trace.root.name));
  const health = node("span", undefined, "health-badge" + (trace.errors.length ? " error" : ""));
  health.append(icon(trace.errors.length ? "error" : "check"), node("span", trace.errors.length ? trace.errors.length + " error span" + (trace.errors.length === 1 ? "" : "s") : "No errors recorded"));
  heading.append(route, health);
  const id = node("div", undefined, "trace-id-line");
  id.append(node("span", "Trace ID"), node("code", trace.id));
  const copy = node("button", undefined, "copy-id"); copy.type = "button"; copy.title = "Copy trace ID"; copy.setAttribute("aria-label", "Copy trace ID"); copy.append(icon("copy")); copy.onclick = () => copyText(trace.id, copy);
  id.append(copy, node("span", trace.spans.length + " spans · " + trace.services + " services · " + new Date(trace.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }), "summary-info"));
  const metrics = node("div", undefined, "metrics");
  const values = [
    ["Total duration", formatDuration(trace.duration), "End-to-end request"],
    ["Model calls", number(trace.models.length), trace.models.length ? formatDuration(trace.models.reduce((sum, span) => sum + span.durationMs, 0)) + " across model calls" : "No model calls in this trace"],
    ["Tokens", trace.hasUsage ? number(trace.inputTokens + trace.outputTokens) : "—", trace.hasUsage ? number(trace.inputTokens) + " in · " + number(trace.outputTokens) + " out" : "Usage not reported"],
    ["Tool calls", number(trace.toolCount), trace.toolCount ? "Backend → MCP server" : "No tool calls in this trace"],
  ];
  for (const [label, value, sub] of values) {
    const metric = node("div", undefined, "metric"); metric.append(node("p", label, "metric-label"), node("p", value, "metric-value"), node("p", sub, "metric-sub")); metrics.append(metric);
  }
  card.append(heading, id, metrics); $("#trace-summary").replaceChildren(card);
}
function selectSpan(id) {
  state.selectedSpan = id; state.inspectorSignature = "";
  for (const row of $("#waterfall").querySelectorAll(".timeline-row")) {
    const active = row.dataset.spanId === id;
    row.classList.toggle("selected", active);
    row.querySelector(".operation-button")?.setAttribute("aria-pressed", String(active));
  }
  renderInspector();
}
function renderWaterfall(trace) {
  const fragment = document.createDocumentFragment();
  const header = node("div", undefined, "waterfall-header"), axis = node("div", undefined, "axis");
  for (let i = 0; i <= 4; i++) { const tick = node("span", i ? formatDuration(trace.duration * i / 4) : "0"); tick.style.left = i * 25 + "%"; axis.append(tick); }
  header.append(node("span", "OPERATION"), axis, node("span", "DURATION")); fragment.append(header);
  const rows = flattenSpans(trace.spans, state.collapsed);
  for (const { span, depth, hasChildren } of rows) {
    const category = spanCategory(span), selected = span.spanId === state.selectedSpan;
    const row = node("div", undefined, "timeline-row category-" + category + (selected ? " selected" : "") + (span.status?.code === 2 ? " error" : ""));
    row.dataset.spanId = span.spanId; row.style.setProperty("--depth", Math.min(5, depth));
    const operation = node("div", undefined, "operation-cell");
    if (hasChildren) {
      const expanded = !state.collapsed.has(span.spanId);
      const toggle = node("button", undefined, "branch-toggle");
      toggle.type = "button"; toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", (expanded ? "Collapse" : "Expand") + " children of " + span.name);
      toggle.append(icon("arrow"));
      toggle.onclick = event => {
        event.stopPropagation();
        if (expanded) state.collapsed.add(span.spanId); else state.collapsed.delete(span.spanId);
        renderWaterfall(trace);
        const replacement = [...$("#waterfall").querySelectorAll(".timeline-row")].find(item => item.dataset.spanId === span.spanId);
        replacement?.querySelector(".branch-toggle")?.focus();
      };
      operation.append(toggle);
    } else operation.append(node("span", undefined, "branch-placeholder"));
    const button = node("button", undefined, "operation-button"); button.type = "button";
    button.setAttribute("aria-pressed", String(selected)); button.setAttribute("aria-label", "Inspect " + span.name);
    const name = node("span", span.name, "operation-name"); name.title = span.name;
    button.append(node("span", undefined, "category-mark"), name); operation.append(button);
    const track = node("button", undefined, "timeline-track"); track.type = "button"; track.tabIndex = -1; track.setAttribute("aria-label", "Inspect timing for " + span.name);
    const bar = node("span", undefined, "span-bar"), geometry = barGeometry(span, trace);
    bar.style.setProperty("--left", geometry.left + "%"); bar.style.setProperty("--width", geometry.width + "%");
    track.title = span.name + " · " + formatDuration(span.durationMs) + " · +" + formatDuration(span.startTime - trace.start);
    track.append(bar);
    row.append(operation, track, node("span", formatDuration(span.durationMs), "row-duration"));
    row.onclick = () => selectSpan(span.spanId);
    fragment.append(row);
  }
  $("#waterfall").replaceChildren(fragment);
  $("#timeline-footer").replaceChildren(node("span", rows.length + " of " + trace.spans.length + " spans visible"), node("span", "Select a span to inspect"));
  $("#expand-all").disabled = state.collapsed.size === 0;
}
function addNote(parent, heading, text) {
  const card = node("div", undefined, "inspector-note"); card.append(node("h4", heading), node("p", text)); parent.append(card);
}
function renderInspector() {
  const span = currentSpan(), trace = currentTrace(); if (!span || !trace) return;
  const signature = JSON.stringify([span, state.tab]);
  if (signature === state.inspectorSignature) return;
  state.inspectorSignature = signature;
  const category = spanCategory(span), contentEvents = (span.events || []).filter(event => typeof event.attributes?.content === "string");
  const panel = document.createDocumentFragment(), top = node("div", undefined, "inspector-top");
  const eyebrow = node("div", undefined, "inspector-eyebrow"); eyebrow.append(node("span", "SELECTED SPAN"), node("span", categoryLabel[category], "category-badge " + category));
  const service = node("p", undefined, "inspector-service"); service.append(node("span", undefined, "trace-dot" + (span.status?.code === 2 ? " error" : "")), node("span", span.service));
  top.append(eyebrow, node("h3", span.name), service); panel.append(top);
  const tabs = node("div", undefined, "inspector-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Span details");
  const tabNames = ["Summary", "Attributes", "Events", "Content"];
  for (const [index, label] of tabNames.entries()) {
    const tab = node("button", label); tab.type = "button"; tab.id = "tab-" + label; tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(state.tab === label)); tab.setAttribute("aria-controls", "span-tab-content"); tab.tabIndex = state.tab === label ? 0 : -1;
    if (label === "Events" || label === "Content") tab.append(node("span", label === "Events" ? (span.events || []).length : contentEvents.length, "tab-count"));
    tab.onclick = () => { state.tab = label; renderInspector(); $("#tab-" + label).focus(); };
    tab.onkeydown = event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      state.tab = tabNames[event.key === "Home" ? 0 : event.key === "End" ? tabNames.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabNames.length) % tabNames.length];
      renderInspector(); $("#tab-" + state.tab).focus();
    };
    tabs.append(tab);
  }
  panel.append(tabs);
  const body = node("div", undefined, "inspector-content"); body.id = "span-tab-content"; body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", "tab-" + state.tab); body.tabIndex = 0;
  if (state.tab === "Summary") {
    const grid = node("dl", undefined, "overview-grid");
    const fields = [
      ["Duration", formatDuration(span.durationMs)],
      ["Start offset", "+" + formatDuration(span.startTime - trace.start)],
      ["Status", span.status?.code === 2 ? "Error recorded" : "Completed"],
      ["Span kind", ({0:"Internal",1:"Server",2:"Client",3:"Producer",4:"Consumer"})[span.kind] || "Internal"],
    ];
    if (category === "model") fields.push(["Input tokens", span.attributes?.["gen_ai.usage.input_tokens"] === undefined ? "—" : number(span.attributes["gen_ai.usage.input_tokens"])], ["Output tokens", span.attributes?.["gen_ai.usage.output_tokens"] === undefined ? "—" : number(span.attributes["gen_ai.usage.output_tokens"])]);
    for (const [label, value] of fields) { const field = node("div"); field.append(node("dt", label), node("dd", value, label === "Duration" ? "duration-value" : undefined)); grid.append(field); }
    body.append(grid);
    if (category === "model") {
      const thinking = Boolean(span.attributes?.["ollama.thinking.available"]), recorded = contentEvents.some(event => event.name === "gen_ai.reasoning");
      addNote(body, recorded ? "Model-reported thinking captured" : thinking ? "Thinking returned · content off" : "No thinking field returned", recorded ? "Open Content to read the field returned by the model. This is separate from its final reply." : thinking ? "The provider returned thinking text, but this span did not record it. Enable content capture to inspect future responses." : "This model response included no thinking text. Token counts, timing, and tool decisions are still captured.");
    } else if (span.name === "agent.turn") addNote(body, "Follow the decisions", "Open Events to see which tools the model selected and whether each action succeeded.");
    else if (category === "tool") addNote(body, "Connected across processes", "The client and server spans share one trace. Compare them to separate transport time from store execution.");
    const ids = node("div", undefined, "span-id"); ids.append(node("span", "SPAN ID"), node("code", span.spanId), node("span", "PARENT SPAN"), node("code", span.parentSpanId || "Root span")); body.append(ids);
  } else if (state.tab === "Attributes") {
    const table = node("table", undefined, "attribute-table"); table.setAttribute("aria-label", "Span attributes");
    const tbody = node("tbody");
    for (const [key, value] of Object.entries(span.attributes || {})) { const row = node("tr"); const keyCell = node("th", key); keyCell.scope = "row"; row.append(keyCell, node("td", typeof value === "string" ? value : JSON.stringify(value))); tbody.append(row); }
    table.append(tbody); body.append(table);
    if (!tbody.children.length) body.append(node("p", "No attributes recorded for this span.", "empty-state"));
  } else if (state.tab === "Events") {
    for (const event of span.events || []) {
      const card = node("article", undefined, "event-card"), heading = node("div", undefined, "event-heading");
      heading.append(node("h4", eventLabels[event.name] || event.name), node("time", "+" + formatDuration(event.time - span.startTime)));
      card.append(heading, node("p", event.name, "event-name"));
      for (const [key, value] of Object.entries(event.attributes || {})) if (key !== "content") card.append(node("p", key + ": " + String(value), "event-values"));
      if (typeof event.attributes?.content === "string") {
        const link = node("button", "View captured content", "quiet-button"); link.onclick = () => { state.tab = "Content"; renderInspector(); $("#tab-Content").focus(); }; card.append(link);
      }
      body.append(card);
    }
    if (!span.events?.length) body.append(node("p", "No events on this span. Select agent.turn to inspect tool decisions.", "empty-state"));
  } else {
    for (const event of contentEvents) {
      const card = node("article", undefined, "event-card"); card.append(node("h4", eventLabels[event.name] || event.name));
      let text = event.attributes.content;
      try { const value = JSON.parse(text); text = event.name === "gen_ai.reasoning" && value.text ? value.text : typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch { /* Truncated content may not be valid JSON. */ }
      card.append(node("pre", text, "content-block"));
      if (event.attributes["content.truncated"]) card.append(node("p", "Truncated at the configured capture limit.", "truncated"));
      body.append(card);
    }
    if (!contentEvents.length) addNote(body, "No content recorded", "Content capture is opt-in. Enable OTEL_CAPTURE_CONTENT=true in the backend environment and restart to record future messages and provider-returned thinking. Raw text may include personal data.");
  }
  panel.append(body); $("#inspector").replaceChildren(panel);
}
function renderDetail() {
  const trace = currentTrace();
  if (!trace) {
    $("#trace-summary").replaceChildren();
    $("#waterfall").replaceChildren(node("p", "No trace selected. Send a message in the storefront or adjust the request filters.", "empty-state"));
    return;
  }
  const signature = JSON.stringify(trace.spans);
  if (state.detailSignature !== signature) {
    state.detailSignature = signature;
    renderSummary(trace); renderWaterfall(trace);
  }
  renderInspector();
}
async function update() {
  if (state.loading) return;
  state.loading = true; $("#refresh-now").disabled = true;
  try {
    const response = await fetch("/api/spans", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    const spans = await response.json(), signature = JSON.stringify(spans);
    if (signature !== state.rawSignature) {
      state.rawSignature = signature; state.traces = groupTraces(spans); renderActivities();
      if (currentTrace() && !currentSpan()) selectTrace(state.selectedTrace);
      else if (!currentTrace()) {
        const next = filteredTraces()[0];
        if (next) selectTrace(next.id);
      }
      renderRequests(); renderDetail();
    }
    state.latestUpdate = new Date();
    $("#connection-status").classList.remove("error");
    $("#connection-status").textContent = number(spans.length) + " spans retained · Updated " + state.latestUpdate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  } catch {
    if (!$("#connection-status").classList.contains("error")) announce("Trace connection interrupted. Showing the last received data.");
    $("#connection-status").classList.add("error");
    $("#connection-status").textContent = "Connection interrupted. Showing the last received data. Use refresh to retry.";
  } finally { state.loading = false; $("#refresh-now").disabled = false; }
}
function filterChanged() { renderRequests(); }
$("#search").oninput = filterChanged;
$("#chat-only").onclick = () => { state.chatOnly = !state.chatOnly; $("#chat-only").setAttribute("aria-pressed", String(state.chatOnly)); filterChanged(); };
$("#errors-only").onclick = () => { state.errorsOnly = !state.errorsOnly; $("#errors-only").setAttribute("aria-pressed", String(state.errorsOnly)); filterChanged(); };
$("#auto-refresh").onchange = () => { $("#live-label").textContent = $("#auto-refresh").checked ? "Live updates" : "Updates paused"; if ($("#auto-refresh").checked) update(); };
$("#refresh-now").onclick = async () => { await update(); if (!$("#connection-status").classList.contains("error")) announce("Local traces refreshed."); };
$("#expand-all").onclick = () => { state.collapsed.clear(); const trace = currentTrace(); if (trace) renderWaterfall(trace); };
document.addEventListener("keydown", event => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#search").focus(); }
  if (event.key === "Escape" && document.activeElement === $("#search")) { $("#search").value = ""; filterChanged(); }
});
setInterval(() => { if ($("#auto-refresh").checked) update(); }, 3000);
update();
