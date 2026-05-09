import { paymentMiddleware, x402ResourceServer } from "astro-x402";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const facilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    extensions: [],
    signers: {},
  }),
  verify: async () => ({ isValid: false, invalidReason: "stage_2_no_verify" }),
  settle: async () => ({
    success: false,
    errorReason: "stage_2_no_settle",
    transaction: "",
    network: "eip155:84532",
  }),
};

const server = new x402ResourceServer(facilitator).register(
  "eip155:84532",
  new ExactEvmScheme(),
);

export const onRequest = paymentMiddleware(
  {
    "GET /protected": {
      accepts: {
        scheme: "exact",
        price: "$0.001",
        network: "eip155:84532",
        payTo: "0x0000000000000000000000000000000000000001",
      },
      description: "Smoke test",
    },
  },
  server,
);
