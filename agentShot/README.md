# AgentShot — Agentic Ecommerce Demo (MCP-powered)

A minimal agentic ecommerce storefront. A chat-based shopping assistant uses
**MCP (Model Context Protocol) tools** to search products, recommend items,
manage the cart, and check out — instead of the agent guessing or hardcoding
business logic.

## Architecture

```
web/            Next.js storefront UI (product grid + chat widget)
agent-backend/  Express API: hosts the agent loop (Claude + tool use)
                and spawns the MCP server as an MCP client over stdio
mcp-server/     MCP server exposing ecommerce tools, backed by mock JSON data
```

Agents (implemented as MCP tools the agent can call):
- **product_search** → `search_products`
- **recommendations** → `get_recommendations`
- **cart_checkout** → `add_to_cart`, `remove_from_cart`, `get_cart`, `checkout`

The agent backend acts as the MCP **client**: it connects to the MCP server
over stdio, lists its tools, exposes them to Claude as tool-use tools, and
executes whichever tools Claude calls in a loop until it has a final answer.

## Setup

```powershell
npm install
copy agent-backend\.env.example agent-backend\.env   # then add your ANTHROPIC_API_KEY
copy web\.env.local.example web\.env.local
npm run build                                        # builds mcp-server + agent-backend
```

## Run (2 terminals)

```powershell
npm run dev:backend   # http://localhost:4000
npm run dev:web       # http://localhost:3000
```

The backend spawns `mcp-server/dist/index.js` as a child process automatically,
so run `npm run build` (or `npm run build -w mcp-server`) at least once before
starting the backend, and again after editing `mcp-server/src`.

## Try it

Open http://localhost:3000 and ask the assistant things like:
- "Find me wireless headphones under $150"
- "What do you recommend to go with the Summit Trail Backpack?"
- "Add the Pulse Fitness Tracker to my cart"
- "What's in my cart?"
- "Checkout, ship to 123 Main St, Springfield"

## Notes / next steps

- Data is mock JSON (`mcp-server/src/data/products.json`); swap `store.ts` for
  a real DB without touching the MCP tool definitions or the agent.
- Cart state is in-memory per `sessionId`; swap for Redis/DB for persistence.
- Add more agents (inventory, promotions, order support) by registering more
  MCP tools in `mcp-server/src/index.ts` — the agent picks them up automatically.
