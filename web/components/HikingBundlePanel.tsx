"use client";
import { useEffect, useState } from "react";
import { money, ShopperState } from "../lib/api";

export default function HikingBundlePanel({ state, busy, onAction }: {
  state: ShopperState | null;
  busy: boolean;
  onAction: (path: string, body: unknown, success: string) => Promise<void>;
}) {
  const [budget, setBudget] = useState("150");
  const plan = state?.bundle;
  useEffect(() => { if (plan) setBudget(String(plan.budget)); }, [plan?.bundleId]);
  const budgetChanged = !!plan && Number(budget) !== plan.budget;
  return <section className="hiking-panel" aria-labelledby="hiking-heading">
    <div className="hiking-intro">
      <div className="hiking-symbol" aria-hidden="true">△</div>
      <div><p className="eyebrow">A head start for your next trail</p><h2 id="hiking-heading">Build your hiking bundle</h2>
        <p className="muted">Pick a budget. Preview a few useful finds, then add them together.</p></div>
    </div>
    <form className="bundle-form" onSubmit={event => {
      event.preventDefault();
      onAction("/bundle/preview", { budget: Number(budget) }, "Hiking preview ready. Review the picks before adding them.");
    }}>
      <div><label htmlFor="hiking-budget">Total cart budget (USD)</label><input id="hiking-budget" type="number" min="1" max="10000" step="0.01" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} disabled={busy || !state} required aria-describedby="budget-help" /></div>
      <button className="primary" disabled={busy || !state}>{busy ? "Working…" : "Preview hiking bundle"}</button>
    </form>
    <p className="bundle-help muted" id="budget-help">Includes your current cart and 8% demo tax. Existing hiking picks are kept without adding duplicates.</p>
    {plan && <div className="bundle-preview" aria-live="polite">
      <div className="section-heading"><h3>Your trail picks</h3><span>{plan.items.length} new item{plan.items.length === 1 ? "" : "s"} · {money(plan.budget)} budget</span></div>
      <ul className="bundle-items">{plan.items.map(item => <li key={item.productId}>
        <div><strong>{item.name}</strong><p>{item.reason}</p></div><span>{money(item.lineTotal)}</span>
      </li>)}</ul>
      <dl className="bundle-totals">
        <div><dt>Current cart, including tax</dt><dd>{money(state!.cart.total)}</dd></div>
        <div><dt>New picks, including tax</dt><dd>+{money(plan.additionalTotal)}</dd></div>
        <div><dt>Projected cart total</dt><dd><strong>{money(plan.projectedCart.total)}</strong></dd></div>
        <div><dt>Left in your budget</dt><dd>{money(Math.round((plan.budget - plan.projectedCart.total) * 100) / 100)}</dd></div>
      </dl>
      <p className="muted">These are starter picks from the demo collection. Adjust them for your trip. Preview expires at {new Date(plan.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
      {budgetChanged && <p className="muted" role="status">Budget changed. Preview again before adding.</p>}
      <button className="primary full" disabled={busy || budgetChanged} onClick={() => onAction("/bundle/apply", { bundleId: plan.bundleId }, "Hiking bundle added. Your cart is ready to review.")}>{busy ? "Working…" : "Add hiking bundle"}</button>
    </div>}
    {!plan && <p className="bundle-footnote">You can also ask the assistant: “Build a hiking bundle under $150.”</p>}
  </section>;
}
