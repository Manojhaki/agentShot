# AgentShot OpenTelemetry

Tracing is enabled by default using a local file exporter. No collector, Docker installation, API key or remote account is required.

## View a trace

1. Build the services with npm.cmd run build:services and run the backend normally.
2. Run npm.cmd run traces from the project root.
3. Open http://127.0.0.1:4310 and send a message through the storefront.
4. Select a request on the left. The summary shows elapsed time, model calls, token usage and tool count.
5. Click a waterfall row to inspect Summary, Attributes, Events or captured Content. Bars share one time axis; nested span durations are not added to the request total.

Trace Search shows all requests by default, including checkout confirmations. Recent activities lists the latest eight shopping and chat requests with links to their traces. Enable Chat only to focus on assistant requests, use Errors only to find failed spans, or search by name, service or trace ID. The selected span and inspector tab stay in place during refresh. Use / to focus search, Escape to clear it, and arrow keys to navigate requests or inspector tabs.

The chat's collapsed **Behind the scenes** panel shows its trace ID. HTTP responses also include X-Trace-Id, and chat/error JSON responses include traceId when tracing is active.

The viewer shows requests, model iterations, token counts, durations, tool selections, errors and nested execution across two services:

POST /api/chat
  agent.turn
    mcp.list_tools
    chat qwen2.5:7b
    mcp.client plan_hiking_bundle
      mcp.server plan_hiking_bundle
        store.planHikingBundle
          sqlite.transaction
    chat qwen2.5:7b

W3C traceparent/tracestate are carried in MCP request _meta, so the child MCP process belongs to the same trace. Incoming HTTP W3C context is accepted as well. Database spans describe store operations and transactions, not raw SQL statements. Frontend rendering is not instrumented.

## What “thinking” means

Ollama can return message.thinking separately from message.content on a thinking-capable model. AgentShot records its presence and character count by default. It does not synthesize explanations, request private internal reasoning, or infer reasoning steps from latency.

To opt into model-reported reasoning text, add this to agent-backend/.env and restart the backend:

```dotenv
OTEL_CAPTURE_CONTENT=true
```

When present, the model's returned field becomes a gen_ai.reasoning event on the model span with source ollama.message.thinking. The regular chat response never includes that reasoning text.

Your current model may not return a thinking field. In that case the viewer says so; timings, tool decisions and usage still appear. If using a model that supports a thinking control, OLLAMA_THINK=true (or a supported named level) forwards Ollama's think option. Leave it unset for the provider default. Do not enable it for a model that does not support it. Check the selected model's /api/show response for supported values.

The chat request is non-streaming. A returned thinking block is captured after inference finishes; it is not a live per-token timeline. Token counts come from Ollama's prompt_eval_count/eval_count; no separate reasoning-token count is invented.

## Content and retention

Default traces include only operation metadata, timings, tool names, token counts, statuses and error categories. They exclude shopper messages, model output, reasoning text, tool arguments/results, cookies, query strings, raw session IDs, shipping addresses and SQL values.

OTEL_CAPTURE_CONTENT=true also enables prompt/reply and tool payload events. These raw text fields can contain personal data, including addresses typed in messages or echoed in tool results. Structured session IDs, address fields and credential fields are redacted; UUIDs in text are replaced. This is not a general-purpose personal-data scrubber. Use opt-in content capture only with data you intend to record.

OTEL_CONTENT_MAX_BYTES limits each content event (default 8192 bytes, capped at 65536). Truncated events are labeled. Default local files are telemetry/data/agentshot-backend.jsonl and agentshot-mcp.jsonl, ignored by Git. Each service rotates one backup after 10 MB. The viewer reads a bounded tail and shows up to 5000 spans, so older or partial traces may disappear. Files remain on disk until rotated or explicitly removed; the .gitignore rule does not make them secret.

The viewer binds only to 127.0.0.1 and rejects non-local Host headers. It is a local developer tool, not an authenticated public dashboard.

## Configuration

Set backend variables in agent-backend/.env and restart:

| Variable | Default / purpose |
| --- | --- |
| AGENTSHOT_OTEL_EXPORTER | file; also otlp, both, none |
| AGENTSHOT_TELEMETRY_DIR | Absolute directory shared by backend, MCP and viewer |
| OTEL_CAPTURE_CONTENT | false; opt-in messages, payloads and model-reported reasoning |
| OTEL_CONTENT_MAX_BYTES | 8192 bytes per content event |
| OTEL_SDK_DISABLED | true disables the SDK entirely |
| OTEL_EXPORTER_OTLP_TRACES_ENDPOINT | Full OTLP HTTP/JSON traces URL |
| OTEL_EXPORTER_OTLP_ENDPOINT | Standard OTLP base URL, when a traces URL is not set |
| OTEL_EXPORTER_OTLP_TRACES_HEADERS | Standard OTLP authorization/configuration headers |
| OTEL_EXPORTER_OTLP_TRACES_TIMEOUT | Export timeout in milliseconds; default 3000 |
| OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG | Standard OpenTelemetry sampling controls |
| OLLAMA_THINK | Optional provider thinking control; unset by default |

Each process has a distinct resource service.name: agentshot-backend and agentshot-mcp. Only selected telemetry configuration is forwarded to the MCP child, not the full parent environment. Telemetry never logs to MCP stdout.

The viewer is a separate process. If using a custom directory, set AGENTSHOT_TELEMETRY_DIR in the shell that starts npm.cmd run traces, too. TRACE_VIEWER_PORT overrides port 4310.

Export failures do not fail shopping operations, and shutdown/flush errors are handled. OTLP uses a bounded batch processor; local file export uses a simple processor. Normal shutdown flushes telemetry; forcibly killing a process can lose its last buffered spans.

## Optional OTLP export

To send traces to your own OTLP HTTP/JSON collector, set:

```dotenv
AGENTSHOT_OTEL_EXPORTER=both
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
```

Replace the endpoint with your collector's URL and restart the backend. Local file traces remain available in both mode. Remote exporters receive whichever metadata/content you enable; file-only is the default. No external collector is required for the local trace viewer.

## Verification

npm.cmd test covers real HTTP + Ollama fixture + MCP stdio + SQLite trace parentage, input/output token counts, content-off privacy, opt-in reasoning, absent reasoning, failure spans, local viewer access and actual OTLP HTTP payload export. It also checks that a failed collector or trace directory cannot fail application work.

References:
- [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)
- [Ollama thinking](https://docs.ollama.com/capabilities/thinking)
- [Ollama chat API](https://docs.ollama.com/api/chat)
