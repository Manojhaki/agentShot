
# AgentShot : AI shopping demo

AgentShot is a local shopping website with an AI assistant. Ask for products, build a cart, and place a demo order. Trace Search shows what happened behind the scenes.

For example: **“Find wireless headphones under $150.”** The model chooses a shopping tool, the tool searches the database, and the assistant explains the results.

This is a proof of concept: products are fictional, shipping is simulated, tax is a flat 8%, and no real payment is taken.

## Project structure

| Folder | What it does |
| --- | --- |
| `web/` | The Next.js website: products, chat, cart, checkout, and receipts. |
| `agent-backend/` | The Express backend: receives website requests, talks to the local model, and runs the tools it selects. |
| `mcp-server/` | Shopping tools that search products, check stock, update carts, and handle checkout. SQLite saves the data. |
| `telemetry/` | OpenTelemetry tracing and Trace Search: shows model calls, tool calls, database work, timing, and errors. |
| `tests/` | Automated checks for shopping, checkout, shopper separation, and tracing. |

```text
Shopper → Website → Backend → Local model through Ollama
                      ↓           selects tools
                  MCP shopping tools → SQLite database

OpenTelemetry records the steps → Trace Search displays them
```

There is one assistant using tools. It can prepare checkout, but the shopper must click **Confirm demo order** to place an order.

## What you need

- **Node.js 22.13 or newer**, with npm. The database uses Node's built-in SQLite support.
- **Ollama**, installed and running on your computer.
- **Git**, if you want to clone the repository.
- Enough memory to run the model. Response speed depends on your computer.

The model runs locally. No AI API key or per-request API fee is required; it uses your computer's resources and electricity.

## First-time setup

These commands are for **Windows PowerShell**. On macOS or Linux, use `npm` instead of `npm.cmd` and `cp` instead of `Copy-Item`.

### 1. Open the project

```powershell
git clone https://github.com/Manojhaki/agentShot.git
cd agentShot
```

If you already have the project, open a terminal in its root folder, where `package.json` is located.

### 2. Download the model

With Ollama running:

```powershell
ollama pull qwen2.5:7b
ollama list
```

Ollama normally runs in the background. If it is not running, start it in a separate terminal before downloading the model, and leave that terminal open:

```powershell
ollama serve
```

If this says the port is already in use, Ollama may already be running.

### 3. Install and build

Run these from the project root. Copy the settings files only on first setup: copying them again replaces your local settings.

```powershell
npm.cmd install
Copy-Item agent-backend/.env.example agent-backend/.env
Copy-Item web/.env.local.example web/.env.local
npm.cmd run build
```

The database is created automatically when the shopping tools first run. No separate database installation is needed.

## Run the project

Keep Ollama running. Open **three terminals**, each in the project root.

**Terminal 1 — Backend**

```powershell
npm.cmd run dev:backend
```

**Terminal 2 — Website**

```powershell
npm.cmd run dev:web
```

**Terminal 3 — Trace Search**

```powershell
npm.cmd run traces
```

| Service | Address |
| --- | --- |
| Shopping website | http://localhost:3000 |
| Backend product API | http://localhost:4000/api/products |
| Trace Search | http://127.0.0.1:4310 |
| Ollama | http://localhost:11434 |

If port 3000 is busy, the website chooses another port. Open the address printed in its terminal, such as `http://localhost:3001`. To choose port 3001 explicitly:

```powershell
npm.cmd run dev -w web -- --port 3001
```

Use **localhost** for both the website and backend so the shopper cookie works correctly. The backend address alone is not a web page; `/api/products` returns product data.

Press **Ctrl+C** in a terminal to stop its service.

## Try the demo

1. Browse the 40 demo products or ask **“Find wireless headphones under $150.”**
2. Add products through the website or chat. Both use the same cart.
3. Ask **“What's in my cart?”** The backend reads the saved cart and returns its current items and totals.
4. Try **“Build a hiking bundle under $150.”** Review the preview, then click **Add hiking bundle**. The budget includes existing cart items and tax.
5. Enter a fictional, complete shipping address and click **Review checkout**.
6. Check the items and total, then click **Confirm demo order**.
7. Open the receipt in **Saved orders**.

Checkout reviews and bundle previews expire after 15 minutes. Cart changes require a new review or preview. Checkout checks stock again and saves the order, reduces stock, and clears the cart together. Repeating the same confirmation returns the original order.

Hiking bundles are starter suggestions, not a complete hiking equipment checklist.

## Use Trace Search

Open http://127.0.0.1:4310 while using the store.

- **Recent activities** shows the latest shopping and chat actions. Click one to open its trace.
- A **trace ID** identifies one request. Its timeline includes related model calls, MCP tools, and database operations.
- **Shopping session** groups requests from the same browser shopper, including search, cart changes, checkout, and order confirmation.
- Click **View this shopping session** on a trace to follow that shopper's journey.
- Search by activity name, trace ID, or the full session identifier. **Chat only** and **Errors only** narrow the list.
- Select a step and open **Summary**, **Attributes**, **Events**, or **Content** for details.

The session identifier is a hash, not the browser's access cookie. It remains the same while that cookie remains, including across backend restarts. Older traces without it cannot be grouped retroactively. Only retained traces appear; use **Saved orders** in the store for saved receipts.

### See messages sent and received

By default, traces save timings, tool names, token counts, and errors without saving message content.

To capture messages, model responses, and tool inputs and outputs, change this line in `agent-backend/.env`:

```dotenv
OTEL_CAPTURE_CONTENT=true
```

Restart the backend and send a **new** message. Select a step in Trace Search and open **Content**. Old traces will not gain content.

Use fictional personal details: captured text can include information typed into chat or returned by tools.

If the model returns a separate thinking field, content capture also records that model-reported text. Some models do not return it. This is not a complete view into the model's internal thinking.

See the [tracing guide](telemetry/README.md) for retention, capture limits, and optional export settings. No external collector is required for the local viewer.

## Settings and saved data

Backend settings go in `agent-backend/.env`:

| Setting | Default or purpose |
| --- | --- |
| `PORT` | `4000` — backend port |
| `OLLAMA_URL` | `http://localhost:11434` — model service |
| `OLLAMA_MODEL` | `qwen2.5:7b` — choose a tool-capable model |
| `AGENTSHOT_DB_PATH` | Optional absolute path to a different SQLite file |
| `WEB_ORIGIN` | Optional additional website origin allowed to call the backend |
| `OTEL_CAPTURE_CONTENT` | `false` — enable to record messages and tool content |

Website settings go in `web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Restart the affected service after changing settings. Never put secrets in `NEXT_PUBLIC_*` variables because visitors can see them.

- Carts, stock, reviews, and orders are saved in `mcp-server/data/agentshot.sqlite` and survive restarts.
- Chat history is kept in memory and resets when the backend restarts.
- Clearing browser cookies loses access to that browser's cart and receipts. There are no user accounts.
- Trace files are stored in `telemetry/data/` by default.
- Local settings, databases, and trace files are excluded from Git.
- Products start from `mcp-server/src/data/products.json`. New product IDs are inserted on startup; changing seed data does not overwrite existing catalog records or stock.

## Tests and builds

```powershell
npm.cmd test
npm.cmd run build
```

Tests use temporary databases and do not change demo inventory. They check shopping, checkout, saved data, separate shoppers, duplicate confirmations, errors, and tracing.

After editing MCP server or shared telemetry code, rebuild the services, then restart the backend:

```powershell
npm.cmd run build:services
```

## Common problems

| Problem | What to check |
| --- | --- |
| Products do not load | Start the backend and check `NEXT_PUBLIC_API_URL`. |
| The assistant cannot reach the model | Start Ollama and check that `qwen2.5:7b` appears in `ollama list`. |
| Model responses are slow | Speed depends on your computer's available memory and CPU/GPU. |
| Backend port 4000 is in use | Stop the old backend before starting another one. |
| Chat and cart seem to use different shoppers | Use `localhost` consistently and the same browser profile. |
| Traces have no message content | Enable content capture, restart the backend, and send a new message. |
| Older activity is missing from a session | Old traces may lack session identifiers or may have rotated out. |

This is a local demo. Public hosting needs authentication, deployment-specific origin and cookie settings, and real payment, tax, and shipping integrations before real shopping use.
