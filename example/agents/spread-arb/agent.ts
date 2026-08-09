// spread-arb: fee-aware, delta-neutral cross-venue arbitrage.
// Buys the base with USDC on the cheapest venue and sells it on the richest venue in one bundle.
import type { AgentAction, AgentObservation, BundleActionItem } from "@eris/sdk";
import { marketViews, type MarketView } from "../lib/markets.js";

type SwapLeg = Extract<BundleActionItem, { tokenIn: string }>;

const SAFETY_MARGIN_BPS = 50;
const MIN_SIZE_BPS = 250;
const MAX_SIZE_BPS = 2000;
const SIZE_GAIN = 150_000;
const SLIPPAGE_BPS = 120;

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function baseUnits(usdcUnits: bigint, price: number, decimals: number): bigint {
  const usdc = Number(usdcUnits) / 1_000_000;
  return BigInt(Math.floor((usdc / price) * 10 ** decimals));
}

export function decide(obs: AgentObservation): AgentAction | Record<string, unknown> {
  const availableUsdc = BigInt(obs.balances.usdcUnits || "0");
  const maxUsdc = BigInt(obs.limits.maxUsdcInUnits);
  const usdcCap = min(availableUsdc, maxUsdc);
  if (usdcCap <= 0n) return { type: "noop", reason: "no USDC balance" };

  let candidate:
    | { view: MarketView; cheap: MarketView["venues"][number]; rich: MarketView["venues"][number]; edge: number }
    | undefined;

  for (const view of marketViews(obs)) {
    if (view.venues.length < 2) continue;
    let cheap = view.venues[0];
    let rich = view.venues[0];
    for (const venue of view.venues) {
      if (venue.price < cheap.price) cheap = venue;
      if (venue.price > rich.price) rich = venue;
    }
    if (cheap.price <= 0 || rich.price <= 0) continue;
    const spread = rich.price / cheap.price - 1;
    const costs = (cheap.feeBps + rich.feeBps + SAFETY_MARGIN_BPS) / 10_000;
    const edge = spread - costs;
    if (edge <= 0 || (candidate && edge <= candidate.edge)) continue;
    candidate = { view, cheap, rich, edge };
  }

  if (!candidate) return { type: "noop", reason: "no profitable cross-venue spread" };

  const sizeBps = Math.min(MAX_SIZE_BPS, Math.max(MIN_SIZE_BPS, Math.floor(candidate.edge * SIZE_GAIN)));
  const usdcIn = (usdcCap * BigInt(sizeBps)) / 10_000n;
  const bought = baseUnits(usdcIn, candidate.cheap.price, candidate.view.baseDecimals);
  // Leave a 2% buffer so the sell leg is viable after buy-side fees and price impact.
  const sellAmount = (bought * 98n) / 100n;
  if (usdcIn <= 0n || sellAmount <= 0n)
    return { type: "noop", reason: "trade amount below minimum" };

  const withBase = (action: SwapLeg): SwapLeg =>
    candidate.view.base === "WETH" ? action : { ...action, base: candidate.view.base };
  const buy: SwapLeg = {
    type: candidate.cheap.swapType,
    tokenIn: "USDC",
    amountIn: usdcIn.toString(),
    slippageBps: SLIPPAGE_BPS,
  };
  const sell: SwapLeg = {
    type: candidate.rich.swapType,
    tokenIn: candidate.view.base,
    amountIn: sellAmount.toString(),
    slippageBps: SLIPPAGE_BPS,
  };

  return {
    type: "bundle",
    actions: [withBase(buy), withBase(sell)],
    maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
  };
}
