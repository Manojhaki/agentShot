import { initializeTelemetry, inSpan, flushTelemetry, shutdownTelemetry } from "@agentshot/telemetry";
initializeTelemetry("export-fixture");
const value = await inSpan("export.fixture", { "fixture.safe": true }, async () => 42);
await flushTelemetry();
await shutdownTelemetry();
console.log(value);
