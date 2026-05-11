# astro-x402 playground

This playground is a self-contained manual test for the full x402 payment flow
on Base Sepolia. It performs a real testnet USDC transfer, so use disposable
wallets only.

## What This Tests

The flow is:

1. Start the Astro resource server with a `PAY_TO_ADDRESS`.
2. Request `/protected` with an x402-aware client.
3. The first request receives `402 payment-required`.
4. The client signs an EIP-3009 authorization and retries.
5. The public facilitator verifies and settles the transfer.
6. The final response should be `200` with a `payment-response` header.

The playground uses:

- Network: Base Sepolia, `eip155:84532`
- Scheme: `exact`
- Facilitator: `https://x402.org/facilitator`
- Testnet USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Price: `$0.001`, which should settle as `1000` USDC atomic units

## 1. Install dependencies

From the repository root:

```bash
pnpm install
```

## 2. Generate disposable wallets

```bash
pnpm --filter playground wallet:generate
```

Save the output somewhere temporary:

- `Payer address`: receives faucet funds and signs the payment
- `Payer private key for PK`: passed only as an environment variable
- `Recipient address for PAY_TO_ADDRESS`: receives the testnet USDC payment

Do not send mainnet assets to these addresses.

## 3. Fund the payer

Use a Base Sepolia faucet to send both assets to the payer address:

- Base Sepolia testnet USDC for the x402 payment
- Base Sepolia ETH as a small testnet buffer

Base faucet docs:

```text
https://docs.base.org/base-chain/network-information/network-faucets
```

Check balances:

```bash
pnpm --filter playground wallet:balance 0xPayerAddress
```

You only need a small amount. For the default `$0.001` route price, `0.001`
testnet USDC is enough for one successful payment. The `exact` EVM flow uses
EIP-3009, so the facilitator broadcasts the transaction and pays the transaction
fee. It is normal for the payer's Base Sepolia ETH balance to stay unchanged
after a successful payment.

## 4. Start the playground server

Use the generated recipient address as `PAY_TO_ADDRESS`:

```bash
PAY_TO_ADDRESS=0xRecipientAddress pnpm --filter playground dev
```

In another terminal, confirm the protected route asks for payment:

```bash
curl -i http://localhost:4321/protected
```

Expected result: `402` and a `payment-required` response header.

## 5. Run the x402 payment client

In another terminal:

```bash
cd playground
read -r -s "PK?Payer private key: "
echo
PK="$PK" pnpm x402:pay
unset PK
```

Expected output:

- `status: 200`
- `payment-response` is present
- `decoded payment-response.success` is `true`
- `decoded payment-response.transaction` is a real transaction hash
- `settlement-overrides: null`
- `body: { ok: true }`

## 6. Verify on-chain

Open the transaction hash from `decoded payment-response.transaction` in a Base
Sepolia explorer and confirm:

- `Status` is `Success`
- `Interacted With (To)` is the Base Sepolia USDC contract:
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- the transaction `From` may be the facilitator address, not the payer address
- under `ERC-20 Tokens Transferred`, USDC moved from the payer address to
  `PAY_TO_ADDRESS`
- the token amount is `0.001 USDC` for the default `$0.001` price

## Useful commands

Generate new wallets:

```bash
pnpm --filter playground wallet:generate
```

Check any Base Sepolia address:

```bash
pnpm --filter playground wallet:balance 0xAddress
```

Use a different protected URL:

```bash
PROTECTED_URL=http://localhost:4321/protected PK=0xPrivateKey pnpm --filter playground x402:pay
```

## Troubleshooting

- `Protected route returns 200`: confirm `src/pages/protected.ts` exports
  `prerender = false` and `astro.config.mjs` uses server output.
- `Client keeps returning 402`: confirm server and client both use
  `eip155:84532`.
- `insufficient_funds`: fund the payer with Base Sepolia USDC and ETH.
- `invalid_exact_evm_transaction_simulation_failed`: this can happen when Base
  Sepolia or the public facilitator's RPC backend is temporarily unhealthy. If
  the payer has enough USDC, wait and retry later.
- `wallet:balance` reports `no backend is currently healthy to serve traffic`:
  the public Base Sepolia RPC endpoint is unhealthy. Retry later.
- `settlement-overrides` is visible to the client: this is a regression in the
  header stripping behavior.
- `payment-response` is missing: check the Astro server logs and facilitator
  reachability.
