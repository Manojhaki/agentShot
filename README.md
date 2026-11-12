# AgentShot — local AI shopping demo

A storefront with an Ollama shopping assistant, MCP ecommerce tools, and SQLite-backed carts, inventory, checkout reviews and orders. This is a demo: shipping is simulated, tax is a flat 8%, and no payment is processed.

## Requirements and setup

Use Node.js 22.13 or newer (the store uses built-in Node SQLite). Start Ollama with the tool-capable model:

```powershell
ollama pull qwen2.5:7b
ollama serve
npm.cmd install
copy agent-backend\.env.example agent-backend\.env
copy web\.env.local.example web\.env.local
npm.cmd run build
```

Ollama may already be running in the background. Set OLLAMA_MODEL and OLLAMA_URL in agent-backend/.env to use another local model.

## Run

In two terminals:

```powershell
npm.cmd run dev:backend
npm.cmd run dev:web
```

The backend defaults to http://localhost:4000; the storefront defaults to http://localhost:3000 and selects another port if busy. Use localhost for both services so the session cookie is shared correctly. The backend must restart after rebuilding MCP changes.

## Demo catalog

The catalog contains 40 fictional products: 10 each in electronics, outdoors, home and apparel. Prices, ratings and stock are demo data, with products from $14.99 to $129.99. New product IDs in mcp-server/src/data/products.json are inserted automatically on the next MCP server startup. Rebuild the services and restart the backend after changing the catalog; existing stock, carts and orders are preserved.

## Shopping flow

1. Browse products and add them directly, or ask “Find wireless headphones under $150”.
2. Adjust quantities in the visible cart. Chat additions update the same cart.
3. Enter a complete shipping address and choose **Review checkout**. The assistant can also prepare a review from an address.
4. Review the exact items, address, demo tax and total, then click **Confirm demo order**.
5. Open the saved receipt in **Saved orders**. Reloading or restarting the backend preserves carts, inventory and orders.

Reviews expire after 15 minutes and are invalidated by cart changes. Checkout rechecks stock and commits the order, stock deduction and cart clearing in one SQLite transaction. Repeating the same confirmation returns the original order; it cannot create a second purchase.

## Hiking bundles

Use **Build your hiking bundle** above the collection, enter a total cart budget, and choose **Preview hiking bundle**. You can also ask the assistant ?Build a hiking bundle under $150?.

The backend selects a reproducible combination of available hiking products, prioritizing a backpack, hydration and a compact first aid kit, then additional trail accessories if the budget allows. It includes existing cart items and 8% demo tax in the budget and avoids duplicating hiking products already in the cart. A $150 budget with an empty cart currently previews a backpack, bottle and first aid kit for $143.09 total.

The preview explains each pick and shows the projected cart total. **Add hiking bundle** adds all picks together after rechecking prices, stock and the unchanged cart. Nothing is ordered by building or adding a bundle. Continue through the normal shipping review and order confirmation.

Previews are saved per shopper for 15 minutes. Cart edits require rebuilding the preview. Adding is transactional and retry-safe. The assistant can call plan_hiking_bundle, but apply_hiking_bundle is reserved for the storefront button. Selection uses explicit demo priorities, rather than allowing the LLM to invent prices or products. These starter picks do not represent a complete hiking equipment checklist.

## Architecture

- web/: Next.js storefront, chat product cards, cart, checkout review and receipts.
- agent-backend/: Express API, server-issued HttpOnly shopper cookie, Ollama tool loop and MCP client over stdio.
- mcp-server/: validated ecommerce tools and SQLite store seeded from src/data/products.json.

This is one assistant using tools, rather than multiple independent agents. The model can search, recommend, modify its shopper's cart and prepare checkout. The backend always binds shopper tools to the server session and never exposes confirm_checkout to the model. Only the storefront confirmation endpoint places orders. Failed MCP actions are surfaced as errors.

Sessions are anonymous browser sessions, not user accounts. Clearing cookies loses access to that browser's saved cart and receipts. Conversations are in memory and reset on backend restart; carts and orders are durable.

## Data and configuration

The database is created automatically at mcp-server/data/agentshot.sqlite and ignored by Git. Existing stock is preserved on restart; editing seed JSON does not overwrite an existing catalog.

Optional backend variables:

- PORT (default 4000)
- OLLAMA_URL (default http://localhost:11434)
- OLLAMA_MODEL (default qwen2.5:7b)
- AGENTSHOT_DB_PATH (absolute custom SQLite file path)
- WEB_ORIGIN (explicit additional frontend origin)

The frontend uses NEXT_PUBLIC_API_URL (default http://localhost:4000). Requests include the session cookie; client-supplied session IDs are ignored. Localhost origins are allowed for local development. This local demo still needs account authentication, deployment-specific origin restrictions and production payment/tax/shipping integrations before public use.

## Tracing

OpenTelemetry captures HTTP requests, agent/model turns, MCP tools and store transactions. Run npm.cmd run traces and open http://127.0.0.1:4310 to inspect local traces. Prompt, payload and model-reported thinking content is opt-in. See [the tracing guide](telemetry/README.md) for capture settings, privacy defaults, model support and optional OTLP export.

## Validation

```powershell
npm.cmd test
npm.cmd run build
```

Tests cover the HTTP → real MCP → SQLite purchase flow, persistence across database reopen, stock contention, aggregate cart limits, invalid and expired reviews, session isolation, duplicate confirmations, tool failures and model attempts to bypass checkout confirmation. Tests use isolated temporary databases and do not change the demo store's stock.

The root build includes both services and the production frontend. To rebuild just the services, use npm.cmd run build:services.
