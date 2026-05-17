import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = process.env.PK;

if (!privateKey) {
  console.error("PK is required. Example: PK=0x... pnpm x402:pay");
  process.exit(1);
}

if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("PK must be a 0x-prefixed 32-byte EVM private key.");
  process.exit(1);
}

const protectedUrl = process.env.PROTECTED_URL ?? "http://localhost:4321/protected";
const account = privateKeyToAccount(privateKey as `0x${string}`);
const client = new x402Client().register("eip155:84532", new ExactEvmScheme(account));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment(protectedUrl);

console.log("payer:", account.address);
console.log("url:", protectedUrl);
console.log("status:", response.status);
logHeaderJson(response, "payment-required");
logHeaderJson(response, "payment-response");
console.log("settlement-overrides:", response.headers.get("settlement-overrides"));

const body = await response.text();
try {
  console.log("body:", JSON.parse(body));
} catch {
  console.log("body:", body);
}

function logHeaderJson(response: Response, headerName: string) {
  const value = response.headers.get(headerName);
  console.log(`${headerName}:`, value);

  if (!value) {
    return;
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    console.log(`decoded ${headerName}:`, JSON.parse(decoded));
  } catch (error) {
    console.log(`decoded ${headerName}:`, `failed to decode (${String(error)})`);
  }
}
