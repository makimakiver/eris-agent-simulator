// contract-deployer: an agent that *issues (deploys) a contract* on startup, as an honest
// demonstration of the mechanism -- and of the fact that the scorer ignores it.
//
// Why run(ctx) and not decide(): a deploy is a CREATE transaction (no `to`), which the semantic
// action layer cannot express -- rawTxSchema requires `to` (sdk/src/actionSchema.ts). So this agent
// cannot go through ctx.submit; it signs and sends the CREATE itself with its own key, exactly the
// way the liquidator reaches outside the observation for data it needs (ADR 0015 §3). The key is in
// this process's env (ERIS_AGENT_PRIVATE_KEY), set by the coordinator when it spawned us.
//
// What this proves, tying back to the scoring model: deploying a contract earns nothing here. The
// scorer only sums *your wallet's* balances plus positions in the known venues (Uniswap/Aave/GMX/
// Curve/LST/Liquity). A contract you deploy is outside the token registry, so it is `unpriced`, and
// no counterparty with value (flow bots, victims, other agents) ever calls it -- they only trade the
// fixed venues. Net effect on netPnlUsdc/alphaUsdc: zero (minus the gas this deploy spends). This is
// a teaching agent, not a competitive strategy.
//
// The deployed contract is deliberately trivial and benign: it is DoNothing.sol, whose single
// function doNothing() (selector 0x2f576f20) returns nothing. It holds no state and no funds, has no
// owner, no selfdestruct, no fallback that pulls value -- nothing a "scam"/honeypot would need. It
// exists only so there is a real address on-chain to point at.
import { createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentContext } from "@eris/sdk";

// Creation bytecode of DoNothing.sol, compiled with the deployer's forge (solc 0.8.20, optimizer
// 200). Regenerate with:
//   cp example/agents/contract-deployer/DoNothing.sol deployer/contracts/ && \
//     (cd deployer && forge build contracts/DoNothing.sol) && \
//     jq -r '.bytecode.object' deployer/out/DoNothing.sol/DoNothing.json
const DEMO_INIT_CODE: Hex =
  "0x6080604052348015600f57600080fd5b50606580601d6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80632f576f2014602d575b600080fd5b00fea2646970667358221220627732ebef9fb08d063107fd7cb33a8e4ec1f02b741c385bed974b363c401d8264736f6c63430008140033";

export async function run(ctx: AgentContext): Promise<void> {
  const privateKey = process.env.ERIS_AGENT_PRIVATE_KEY as Hex | undefined;
  const rpcUrl = process.env.ERIS_RPC_URL;
  if (!privateKey || !rpcUrl) {
    ctx.log({ reason: "contract-deployer: missing ERIS_AGENT_PRIVATE_KEY / ERIS_RPC_URL" });
    return;
  }

  const account = privateKeyToAccount(privateKey);
  // Own wallet client: ctx.submit is the semantic/rawTx path and cannot send a CREATE. Reuse the
  // runtime's chain object so the chainId matches the coordinator's anvil.
  const wallet = createWalletClient({
    account,
    chain: ctx.walletClient.chain,
    transport: http(rpcUrl),
  });

  try {
    // `to` omitted => CREATE. Deploys DEMO_INIT_CODE; the resulting contract address is deterministic
    // from (sender, nonce).
    const hash = await wallet.sendTransaction({
      chain: ctx.walletClient.chain,
      data: DEMO_INIT_CODE,
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress ?? null;
    const deployedCode = address
      ? await ctx.publicClient.getCode({ address })
      : undefined;

    ctx.log({
      round: ctx.latestObservation()?.round,
      reason: address
        ? `issued demo contract at ${address} (scored value: 0 -- outside the registry)`
        : "deploy mined but no contractAddress in receipt",
      state: {
        deployer: account.address,
        deployedAddress: address,
        txHash: hash,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        codeHash: deployedCode ? keccak256(deployedCode) : null,
      },
    });
  } catch (error) {
    ctx.log({
      reason: `contract-deployer error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Self-driven agent: the process must stay alive for the run's duration (bot.ts awaits run()).
  // Nothing more to do -- one deploy, then idle. Keep the promise pending so we don't exit early and
  // get logged as "exited before the run ended".
  await new Promise<never>(() => {});
}
