import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context, isSpanContextValid, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Context, type Span } from "@opentelemetry/api";
import { ExportResultCode, W3CTraceContextPropagator, type ExportResult } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export { context, trace, SpanKind, SpanStatusCode };
export type { Span, Attributes };
export const defaultTraceDirectory = fileURLToPath(new URL("../data/", import.meta.url));
let sdk: NodeSDK | undefined;
let exportWarningShown = false;
function exportWarning() {
  if (!exportWarningShown) process.stderr.write("[telemetry] Trace export failed; application work continues.\n");
  exportWarningShown = true;
}

const milliseconds = (time: [number, number]) => time[0] * 1000 + time[1] / 1e6;
export class FileSpanExporter implements SpanExporter {
  private file: string;
  constructor(directory: string, service: string) {
    this.file = join(directory, `${service.replace(/[^a-zA-Z0-9_.-]/g, "_")}.jsonl`);
  }
  export(spans: ReadableSpan[], callback: (result: ExportResult) => void) {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Bound local retention to two 10 MB files per service.
      if (existsSync(this.file) && statSync(this.file).size >= 10 * 1024 * 1024) {
        if (existsSync(`${this.file}.1`)) unlinkSync(`${this.file}.1`);
        renameSync(this.file, `${this.file}.1`);
      }
      const lines = spans.map(span => JSON.stringify({
        traceId: span.spanContext().traceId, spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId, name: span.name, kind: span.kind,
        service: span.resource.attributes["service.name"], startTime: milliseconds(span.startTime),
        durationMs: milliseconds(span.duration), status: span.status, attributes: span.attributes,
        events: span.events.map(event => ({ name: event.name, time: milliseconds(event.time), attributes: event.attributes })),
      })).join("\n");
      if (lines) appendFileSync(this.file, `${lines}\n`, { mode: 0o600 });
      callback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      // Export failures must never break shopping or write to MCP stdout.
      callback({ code: ExportResultCode.FAILED, error: error as Error });
    }
  }
  async shutdown() {}
}

export function initializeTelemetry(service: string) {
  if (sdk || process.env.OTEL_SDK_DISABLED === "true") return;
  const mode = process.env.AGENTSHOT_OTEL_EXPORTER ?? "file";
  const processors = [];
  if (mode === "file" || mode === "both") processors.push(new SimpleSpanProcessor(new FileSpanExporter(process.env.AGENTSHOT_TELEMETRY_DIR ?? defaultTraceDirectory, service)));
  if (mode === "otlp" || mode === "both") processors.push(new BatchSpanProcessor(new OTLPTraceExporter({
    timeoutMillis: Number(process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT ?? process.env.OTEL_EXPORTER_OTLP_TIMEOUT ?? 3000),
  }), { scheduledDelayMillis: 1000, exportTimeoutMillis: 4000 }));
  if (mode === "none") return;
  if (!processors.length) throw new Error("AGENTSHOT_OTEL_EXPORTER must be file, otlp, both or none.");
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": service, "service.version": "1.0.0",
      "deployment.environment.name": process.env.NODE_ENV ?? "development",
    }),
    autoDetectResources: false,
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: processors,
  });
  sdk.start();
  process.once("beforeExit", () => { void shutdownTelemetry(); });
}

export async function flushTelemetry() {
  // The global provider can be a proxy; SDK flushes each registered processor on shutdown.
  const provider = trace.getTracerProvider() as unknown as { getDelegate?: () => { forceFlush?: () => Promise<void> }; forceFlush?: () => Promise<void> };
  try { await (provider.forceFlush?.() ?? provider.getDelegate?.().forceFlush?.()); }
  catch { exportWarning(); }
}
export async function shutdownTelemetry() {
  const current = sdk; sdk = undefined;
  if (current) { try { await current.shutdown(); } catch { exportWarning(); } }
}
export function traceId() {
  const current = trace.getActiveSpan()?.spanContext();
  return current && isSpanContextValid(current) ? current.traceId : undefined;
}
export function injectTrace(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
export function extractTrace(meta?: Record<string, unknown>): Context {
  const carrier: Record<string, string> = {};
  for (const key of ["traceparent", "tracestate"]) if (typeof meta?.[key] === "string") carrier[key] = meta[key];
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export function recordError(span: Span, error: unknown, type?: string) {
  const name = type ?? (error instanceof Error && ["Error", "TypeError", "RangeError", "TimeoutError", "AbortError"].includes(error.name) ? error.name : "Error");
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttribute("error.type", name);
  span.recordException({ name, message: contentEnabled() && error instanceof Error ? error.message.slice(0, 2000) : "Operation failed; content capture is disabled." });
}
export function contentEnabled() { return process.env.OTEL_CAPTURE_CONTENT === "true"; }
export function captureContent(span: Span, name: string, value: unknown) {
  if (!contentEnabled()) return;
  const text = JSON.stringify(value, (key, val) => /session.?id|shipping.?address|authorization|cookie|password|secret|api.?key|access.?token/i.test(key) ? "[redacted]" : val) ?? "";
  const redacted = text.replace(/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi, "[redacted id]");
  const limit = Math.max(256, Math.min(65536, Number(process.env.OTEL_CONTENT_MAX_BYTES) || 8192));
  const bytes = Buffer.from(redacted);
  span.addEvent(name, { "content": bytes.subarray(0, limit).toString("utf8"), "content.truncated": bytes.length > limit });
}

export function inSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>, kind = SpanKind.INTERNAL, parent = context.active()): Promise<T> {
  return trace.getTracer("agentshot", "1.0.0").startActiveSpan(name, { attributes, kind }, parent, async span => {
    try { return await fn(span); }
    catch (error) { recordError(span, error); throw error; }
    finally { span.end(); }
  });
}
export function inSpanSync<T>(name: string, attributes: Attributes, fn: (span: Span) => T): T {
  return trace.getTracer("agentshot", "1.0.0").startActiveSpan(name, { attributes }, span => {
    try { return fn(span); }
    catch (error) { recordError(span, error); throw error; }
    finally { span.end(); }
  });
}

// Only explicitly selected configuration crosses the stdio process boundary.
export function telemetryEnvironment(): Record<string, string> {
  const allowed = ["AGENTSHOT_OTEL_EXPORTER", "AGENTSHOT_TELEMETRY_DIR", "OTEL_SDK_DISABLED", "OTEL_CAPTURE_CONTENT", "OTEL_CONTENT_MAX_BYTES", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_EXPORTER_OTLP_TRACES_HEADERS", "OTEL_EXPORTER_OTLP_TIMEOUT", "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", "OTEL_TRACES_SAMPLER", "OTEL_TRACES_SAMPLER_ARG"];
  return Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
}
