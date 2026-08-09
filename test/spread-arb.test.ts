import test from "node:test";
import assert from "node:assert/strict";
import type { AgentObservation } from "@eris/sdk/types.js";
import { decide } from "../example/agents/spread-arb/agent.js";

function observation(): AgentObservation {
  return {
    kind: "observation",
    runId: "spread-arb-test",
    round: 1,
    blockNumber: "1",
    agentAddress: "0x0000000000000000000000000000000000000001",
    fairPriceUsdcPerWeth: 3000,
    oraclePrices: { wethUsd: 3000, usdcUsd: 1 },
    enabledProtocols: ["uniswap", "balancer", "curve"],
    balances: { ethWei: "1", wethWei: "0", usdcUnits: "10000000000" },
    inventory: { valueUsdc: 0, weth: 0, usdc: 0, eth: 0 },
    history: [],
    limits: {
      maxWethInWei: "1000000000000000000",
      maxUsdcInUnits: "5000000000",
      defaultPriorityFeePerGasWei: "10",
      maxPriorityFeePerGasWei: "20",
      defaultSlippageBps: 50,
      maxBundleActions: 5,
      maxLpWethWei: "0",
      maxLpUsdcUnits: "0",
      maxOpenPositions: 0,
      maxGmxSizeUsd: "0",
      maxAaveSupplyWethWei: "0",
      maxAaveBorrowUsdcUnits: "0",
    },
    protocols: {
      uniswap: { pool: { pair: "WETH/USDC", fee: 500, priceUsdcPerWeth: 2900, tick: 0, tickSpacing: 10 }, positions: [] },
      balancer: { priceUsdcPerWeth: 3300 },
      curve: { priceUsdcPerWeth: 3000 },
    },
  };
}

test("spread-arb executes a USDC-to-WETH then WETH-to-USDC bundle across the widest profitable venue spread", () => {
  const action = decide(observation()) as Record<string, unknown>;
  assert.equal(action.type, "bundle");
  const actions = action.actions as Record<string, string>[];
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, "swap");
  assert.equal(actions[0].tokenIn, "USDC");
  assert.equal(actions[1].type, "balancerSwap");
  assert.equal(actions[1].tokenIn, "WETH");
  assert.ok(BigInt(actions[0].amountIn) > 0n);
  assert.ok(BigInt(actions[1].amountIn) > 0n);
});

test("spread-arb returns noop when every venue spread is below fees and safety margin", () => {
  const obs = observation();
  obs.protocols!.uniswap!.pool!.priceUsdcPerWeth = 3000;
  obs.protocols!.balancer!.priceUsdcPerWeth = 3000;
  obs.protocols!.curve!.priceUsdcPerWeth = 3000;
  assert.deepEqual(decide(obs), { type: "noop", reason: "no profitable cross-venue spread" });
});
