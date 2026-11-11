import "dotenv/config";
import { createApp } from "./app.js";
import { initializeTelemetry, shutdownTelemetry } from "@agentshot/telemetry";
import { closeMcpClient } from "./mcpClient.js";
initializeTelemetry("agentshot-backend");
const PORT = Number(process.env.PORT || 4000);
const server = createApp().listen(PORT, () => console.log(`AgentShot backend listening on http://localhost:${PORT}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  const timeout = setTimeout(() => process.exit(0), 5000); timeout.unref();
  server.close(() => { void closeMcpClient().finally(() => shutdownTelemetry()).finally(() => process.exit(0)); });
});
