// @ts-check
import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import x402 from "astro-x402";

const payTo = process.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000001";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    x402({
      routes: {
        "GET /protected": {
          accepts: {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:84532",
            payTo,
          },
          description: "Protected resource",
        },
      },
      facilitator: { url: "https://x402.org/facilitator" },
    }),
  ],
});
