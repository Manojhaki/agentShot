import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addToCart,
  cartSummary,
  prepareCheckout,
  confirmCheckout,
  shopperState,
  planHikingBundle,
  applyHikingBundle,
  recommendProducts,
  removeFromCart,
  searchProducts,
} from "./store.js";

const server = new McpServer({
  name: "agentshot-ecommerce",
  version: "1.0.0",
});

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// Some local LLMs emit "true"/"false" strings or numeric strings for tool
// arguments instead of real booleans/numbers. Coerce leniently so valid
// intent isn't rejected by strict schema validation.
const zLenientBoolean = () =>
  z.preprocess((val) => {
    if (typeof val === "string") {
      if (val.toLowerCase() === "true") return true;
      if (val.toLowerCase() === "false") return false;
    }
    return val;
  }, z.boolean());

const zLenientNumber = () => z.coerce.number();

// Local LLMs often pass placeholder/default values (empty string, 0) for
// optional filters they don't actually intend to use. Normalize those to
// "unset" so filters only apply when the model supplies a meaningful value.
const zOptionalString = () =>
  z.preprocess((val) => (val === "" ? undefined : val), z.string().optional());

const zOptionalMaxPrice = () =>
  z.preprocess((val) => (val === 0 || val === "0" ? undefined : val), zLenientNumber().optional());

// --- Product search / discovery agent tool ---
server.registerTool(
  "search_products",
  {
    title: "Search products",
    description:
      "Search the product catalog by free-text query, category, max price, minimum rating, and stock availability.",
    inputSchema: {
      query: zOptionalString().describe("Free text search, e.g. 'wireless headphones'"),
      category: zOptionalString().describe("Category filter, e.g. 'electronics', 'outdoors', 'home', 'apparel'"),
      maxPrice: zOptionalMaxPrice().describe("Maximum price in USD"),
      minRating: zLenientNumber().optional().describe("Minimum average rating (0-5)"),
      inStockOnly: zLenientBoolean().optional().describe("Only return products currently in stock"),
    },
  },
  async (args) => textResult(searchProducts(args)),
);

// --- Recommendation agent tool ---
server.registerTool(
  "get_recommendations",
  {
    title: "Get product recommendations",
    description:
      "Recommend products, optionally based on a product the shopper is viewing (similar tags/category) or a category, ranked by rating.",
    inputSchema: {
      basedOnProductId: zOptionalString().describe("Product id to base similar recommendations on"),
      category: zOptionalString().describe("Category to recommend within"),
      limit: zLenientNumber().int().positive().optional().describe("Max number of recommendations (default 4)"),
    },
  },
  async (args) => textResult(recommendProducts(args)),
);

// --- Cart & checkout agent tools ---
server.registerTool(
  "add_to_cart",
  {
    title: "Add item to cart",
    description: "Add a product to the shopper's cart by product id and quantity.",
    inputSchema: {
      sessionId: z.string().describe("Shopper session id"),
      productId: z.string(),
      quantity: zLenientNumber().int().positive().default(1),
    },
  },
  async ({ sessionId, productId, quantity }) => {
    try {
      return textResult(addToCart(sessionId, productId, quantity));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.registerTool(
  "remove_from_cart",
  {
    title: "Remove item from cart",
    description: "Remove a product (optionally a specific quantity) from the shopper's cart.",
    inputSchema: {
      sessionId: z.string(),
      productId: z.string(),
      quantity: zLenientNumber().int().positive().optional().describe("Quantity to remove; omit to remove all"),
    },
  },
  async ({ sessionId, productId, quantity }) => {
    try {
      return textResult(removeFromCart(sessionId, productId, quantity));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.registerTool(
  "get_cart",
  {
    title: "Get cart contents",
    description: "Get the current items, subtotal, and item count in the shopper's cart.",
    inputSchema: { sessionId: z.string() },
  },
  async ({ sessionId }) => textResult(cartSummary(sessionId)),
);

server.registerTool(
  "prepare_checkout",
  {
    title: "Prepare checkout review",
    description: "Prepare a checkout review. Does NOT place an order. Shopper must click Confirm demo order in the storefront.",
    inputSchema: {
      sessionId: z.string(),
      shippingAddress: z.string().describe("Full shipping address"),
    },
  },
  async ({ sessionId, shippingAddress }) => {
    try {
      return textResult(prepareCheckout(sessionId, shippingAddress));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);


server.registerTool("plan_hiking_bundle", {
  title: "Preview a budget-aware hiking bundle",
  description: "Build a hiking bundle preview without changing the cart. Budget includes the existing cart and 8% demo tax. Default $150. Tell the shopper to click Add hiking bundle in the storefront; do not add these products separately.",
  inputSchema: { sessionId: z.string(), budget: zLenientNumber().min(1).max(10000).default(150) },
}, async ({ sessionId, budget }) => {
  try { return textResult(planHikingBundle(sessionId, budget)); }
  catch (error) { return { content: [{ type: "text" as const, text: (error as Error).message }], isError: true }; }
});
server.registerTool("apply_hiking_bundle", {
  title: "Add a previewed hiking bundle",
  description: "Storefront-only explicit application of a saved bundle. Not exposed to the model.",
  inputSchema: { sessionId: z.string(), bundleId: z.string().uuid() },
}, async ({ sessionId, bundleId }) => {
  try { return textResult(applyHikingBundle(sessionId, bundleId)); }
  catch (error) { return { content: [{ type: "text" as const, text: (error as Error).message }], isError: true }; }
});

server.registerTool("get_shopper_state", {
  title: "Get cart, review and orders", description: "Get this shopper's cart, pending review and saved orders.",
  inputSchema: { sessionId: z.string() },
}, async ({ sessionId }) => textResult(shopperState(sessionId)));
server.registerTool("confirm_checkout", {
  title: "Confirm reviewed order", description: "Storefront-only confirmation. Never exposed to the model.",
  inputSchema: { sessionId: z.string(), reviewId: z.string().uuid() },
}, async ({ sessionId, reviewId }) => {
  try { return textResult(confirmCheckout(sessionId, reviewId)); }
  catch (err) { return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true }; }
});
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
