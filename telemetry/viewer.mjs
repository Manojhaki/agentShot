import { createServer } from "node:http";
import { openSync, closeSync, fstatSync, readSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const defaultDirectory = fileURLToPath(new URL("./data/", import.meta.url));

export function readSpans(directory) {
  let files;
  try { files = readdirSync(directory).filter(name => /\.jsonl(\.1)?$/.test(name)); } catch { return []; }
  const spans = [];
  for (const file of files) {
    let fd;
    try {
      fd = openSync(join(directory, file), "r");
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      const bytes = Buffer.alloc(size - start);
      readSync(fd, bytes, 0, bytes.length, start);
      let text = bytes.toString("utf8");
      if (start) text = text.slice(text.indexOf("\n") + 1);
      for (const line of text.split("\n")) {
        try { const span = JSON.parse(line); if (span.traceId && span.spanId) spans.push(span); } catch { /* Retry partial appends on refresh. */ }
      }
    } catch { /* Files can rotate during a refresh. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return spans.sort((a,b) => a.startTime - b.startTime).slice(-5000);
}
export function createTraceViewer(directory = defaultDirectory) {
  return createServer((req, res) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) { res.writeHead(403); res.end(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (path === "/api/spans") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(readSpans(directory))); return; }
    const assets = { "/viewer.css": "text/css", "/viewer.js": "text/javascript", "/trace-model.mjs": "text/javascript" };
    if (Object.hasOwn(assets, path)) {
      res.setHeader("Content-Type", assets[path] + "; charset=utf-8");
      res.end(readFileSync(new URL("." + path, import.meta.url))); return;
    }
    if (path === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(readFileSync(new URL("./viewer.html", import.meta.url))); return; }
    if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    res.writeHead(404); res.end();
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.TRACE_VIEWER_PORT || 4310);
  createTraceViewer(process.env.AGENTSHOT_TELEMETRY_DIR || defaultDirectory).listen(port, "127.0.0.1", () => {
    console.log("AgentShot traces: http://127.0.0.1:" + port);
  });
}
