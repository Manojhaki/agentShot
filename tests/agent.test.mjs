import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAgentTurn } from "../agent-backend/dist/agent.js";
import { bindSession } from "../agent-backend/dist/policy.js";
test("cart questions read fresh session-bound data without trusting model memory", async () => {
  const session = randomUUID();
  let cart = { items: [{ name: "Test bottle", quantity: 2, lineTotal: 40 }], subtotal: 40, tax: 3.2, total: 43.2 };
  const dependencies = {
    tools: async () => { throw new Error("No model tools needed"); },
    chat: async () => { throw new Error("Must not ask the model to invent cart contents"); },
    call: async (name, input) => {
      assert.equal(name, "get_cart"); assert.equal(input.sessionId, session);
      return { text: JSON.stringify(cart), isError: false };
    },
  };
  const reply = await runAgentTurn(session, "what is in my cart ?", dependencies);
  assert.match(reply.reply, /Test bottle × 2/); assert.match(reply.reply, /\$43\.20/);
  assert.equal(reply.toolCalls[0].name, "get_cart");
  cart = { items: [], subtotal: 0, tax: 0, total: 0 };
  assert.equal((await runAgentTurn(session, "What's in my cart?", dependencies)).reply, "Your cart is empty.");
  const failed = await runAgentTurn(session, "Show me my cart", { ...dependencies, call: async () => ({ text: "Unavailable", isError: true }) });
  assert.match(failed.reply, /couldn't read/);
  assert.equal(failed.toolCalls[0].isError, true);
});
test("every shopper tool replaces a model-supplied session", () => {
  for (const name of ["add_to_cart","remove_from_cart","get_cart","prepare_checkout","get_shopper_state","plan_hiking_bundle"])
    assert.equal(bindSession(name, { sessionId: "victim" }, "owner").sessionId, "owner");
  assert.throws(() => bindSession("confirm_checkout", {}, "owner"));
  assert.throws(() => bindSession("apply_hiking_bundle", {}, "owner"));
});
test("failed tools reach the model as errors and cannot produce a false checkout confirmation", async () => {
  let turn = 0;
  const session = randomUUID();
  const result = await runAgentTurn(session, "buy it", {
    tools: async () => [],
    call: async (_name, input) => { assert.equal(input.sessionId, session); throw new Error("Out of stock"); },
    chat: async history => {
      if (!turn++) return { role: "assistant", content: "", tool_calls: [{ function: { name: "add_to_cart", arguments: { sessionId: "victim", productId: "p001" } } }] };
      assert.equal(history.at(-1).content, "Out of stock");
      return { role: "assistant", content: "Your order has been confirmed." };
    },
  });
  assert.equal(result.toolCalls[0].isError, true);
  assert.match(result.reply, /Confirm demo order/);
});
test("even a hallucinated confirmation tool call cannot execute", async () => {
  let turn = 0, called = false;
  const result = await runAgentTurn(randomUUID(), "confirm", {
    tools: async () => [],
    call: async () => { called = true; return { text: "{}", isError: false }; },
    chat: async () => !turn++ ? { role: "assistant", content: "", tool_calls: [{ function: { name: "confirm_checkout", arguments: {} } }] } : { role: "assistant", content: "Review and confirm in the cart panel." },
  });
  assert.equal(called, false);
  assert.equal(result.toolCalls[0].isError, true);
});
