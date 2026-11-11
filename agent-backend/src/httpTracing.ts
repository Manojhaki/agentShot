import type { RequestHandler } from "express";
import { context, extractTrace, SpanKind, SpanStatusCode, trace } from "@agentshot/telemetry";

export const httpTracing: RequestHandler = (req, res, next) => {
  const parent = extractTrace({ traceparent: req.headers.traceparent, tracestate: req.headers.tracestate });
  const span = trace.getTracer("agentshot.http", "1.0.0").startSpan(`HTTP ${req.method}`, {
    kind: SpanKind.SERVER, attributes: { "http.request.method": req.method },
  }, parent);
  if (span.isRecording()) res.setHeader("X-Trace-Id", span.spanContext().traceId);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    // Route templates only: never record cookies, query strings or arbitrary URL paths.
    const route = typeof req.route?.path === "string" ? req.route.path : "unmatched";
    span.updateName(`${req.method} ${route}`);
    span.setAttributes({ "http.route": route, "http.response.status_code": res.statusCode });
    if (res.statusCode >= 400 || !res.writableFinished) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  res.once("finish", end);
  res.once("close", end);
  context.with(trace.setSpan(parent, span), next);
};
