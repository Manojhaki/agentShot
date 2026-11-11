import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAgentTurn } from "../agent-backend/dist/agent.js";
import { bindSession } from "../agent-backend/dist/policy.js";
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
