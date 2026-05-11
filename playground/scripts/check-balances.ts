import { createPublicClient, formatEther, formatUnits, getAddress, http } from "viem";
import { baseSepolia } from "viem/chains";

const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const rawAddress = process.argv[2] ?? process.env.ADDRESS;

if (!rawAddress) {
  console.error("Usage: pnpm wallet:balance 0xAddress");
  console.error("   or: ADDRESS=0xAddress pnpm wallet:balance");
  process.exit(1);
}

const address = getAddress(rawAddress);
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const [ethBalance, usdcBalance] = await Promise.all([
  client.getBalance({ address }),
  client.readContract({
    address: baseSepoliaUsdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  }),
]);

console.log(`Address: ${address}`);
console.log(`Base Sepolia ETH: ${formatEther(ethBalance)}`);
console.log(`Base Sepolia USDC: ${formatUnits(usdcBalance, 6)}`);
