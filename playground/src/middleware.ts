import { paymentMiddleware, x402ResourceServer } from "astro-x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

const server = new x402ResourceServer(facilitator).register("eip155:84532", new ExactEvmScheme());
const payTo = process.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000001";

export const onRequest = paymentMiddleware(
  {
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
  server,
);
