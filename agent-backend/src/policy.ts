const publicTools = new Set(["search_products", "get_recommendations", "add_to_cart", "remove_from_cart", "get_cart", "prepare_checkout", "get_shopper_state", "plan_hiking_bundle"]);
const sessionTools = new Set(["add_to_cart", "remove_from_cart", "get_cart", "prepare_checkout", "get_shopper_state", "plan_hiking_bundle"]);

export function bindSession(name: string, args: Record<string, unknown>, sessionId: string) {
  if (!publicTools.has(name)) throw new Error("This action requires confirmation in the storefront.");
  return sessionTools.has(name) ? { ...args, sessionId } : { ...args };
}

export function safeReply(reply: string): string {
  // The model cannot place orders. Confirmation is rendered only from the saved order API.
  if (/\b(order\b.{0,50}\b(placed|confirmed|complete[ds]?)|successfully\s+(placed|processed)|payment\b.{0,25}\b(processed|received|successful))\b/i.test(reply)) {
    return "Check the cart panel for your saved orders. To place a new demo order, review your cart and shipping address, then click Confirm demo order. No payment is processed.";
  }
  return reply;
}
