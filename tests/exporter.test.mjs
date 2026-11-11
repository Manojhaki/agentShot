import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
async function run(env) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/export-trace.mjs", import.meta.url))], { env: { ...process.env, ...env }, stdio: ["ignore","pipe","pipe"] });
  let stdout="",stderr="";
  child.stdout.on("data", data => stdout+=data); child.stderr.on("data", data => stderr+=data);
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}
test("OTLP HTTP exporter sends real OpenTelemetry spans", async t => {
  const batches=[];
  const collector=createServer(async(req,res)=>{
    let body="";for await(const part of req)body+=part;
    batches.push(JSON.parse(body));res.setHeader("Content-Type","application/json");res.end("{}");
  }).listen(0,"127.0.0.1");
  await once(collector,"listening");
  t.after(()=>new Promise(resolve=>collector.close(resolve)));
  const result=await run({ AGENTSHOT_OTEL_EXPORTER:"otlp", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:"http://127.0.0.1:"+collector.address().port+"/v1/traces" });
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.stdout.trim(),"42");
  assert.ok(JSON.stringify(batches).includes("export.fixture"));
  assert.ok(batches[0].resourceSpans);
});
test("unavailable collector and unwritable trace directory do not fail application work", async t => {
  const network=await run({ AGENTSHOT_OTEL_EXPORTER:"otlp", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:"http://127.0.0.1:1/v1/traces", OTEL_EXPORTER_OTLP_TRACES_TIMEOUT:"100" });
  assert.equal(network.code,0,network.stderr);assert.equal(network.stdout.trim(),"42");
  const directory=mkdtempSync(join(tmpdir(),"agentshot-export-"));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,"not-a-directory");writeFileSync(file,"fixture");
  const disk=await run({ AGENTSHOT_OTEL_EXPORTER:"file", AGENTSHOT_TELEMETRY_DIR:file });
  assert.equal(disk.code,0,disk.stderr);assert.equal(disk.stdout.trim(),"42");
});
