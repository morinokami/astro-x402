import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { x402, renderGeneratedMiddleware, detectNamespaces } from "./integration";

const validRoutes = {
  "/api/premium": {
    accepts: {
      scheme: "exact",
      network: "eip155:84532",
      payTo: "0x0000000000000000000000000000000000000001",
      price: "$0.10",
    },
  },
} as const;

const validFacilitator = { url: "https://x402.org/facilitator" };

/**
 * Invoke the integration's `astro:config:setup` hook against stub Astro helpers
 * so the generated middleware file lands in a fresh temp directory.
 *
 * @param integration - The integration object returned by `x402(...)`.
 * @returns The stub spies and the codegen directory URL used for the run.
 */
function runSetupHook(integration: ReturnType<typeof x402>) {
  const codegenDir = pathToFileURL(mkdtempSync(join(tmpdir(), "astro-x402-codegen-")) + "/");
  const addMiddleware = vi.fn();
  const createCodegenDir = vi.fn(() => codegenDir);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fork: vi.fn() };

  // Cast to any: we only exercise the methods the integration uses.
  integration.hooks["astro:config:setup"]!({
    addMiddleware,
    createCodegenDir,
    logger,
  } as never);

  return { addMiddleware, createCodegenDir, codegenDir, logger };
}

describe("x402 integration", () => {
  describe("validation", () => {
    it("throws when routes is missing", () => {
      expect(() => x402({ facilitator: validFacilitator } as never)).toThrow(/routes.*required/);
    });

    it("throws when routes record is empty", () => {
      expect(() => x402({ routes: {}, facilitator: validFacilitator })).toThrow(
        /at least one protected path/,
      );
    });

    it("defaults facilitator to the public URL when omitted and logs info", () => {
      const integration = x402({ routes: validRoutes });
      const { addMiddleware, logger } = runSetupHook(integration);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("https://x402.org/facilitator"),
      );
      const generated = readFileSync(addMiddleware.mock.calls[0][0].entrypoint, "utf8");
      expect(generated).toContain("https://x402.org/facilitator");
    });

    it("does not log the default-facilitator notice when explicitly set", () => {
      const integration = x402({ routes: validRoutes, facilitator: validFacilitator });
      const { logger } = runSetupHook(integration);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("throws when facilitator.url is empty", () => {
      expect(() => x402({ routes: validRoutes, facilitator: { url: "" } })).toThrow(
        /facilitator\[0\]\.url/,
      );
    });

    it("rejects function-valued route fields at runtime (fail-safe)", () => {
      const routesWithFn = {
        "/api/x": {
          accepts: validRoutes["/api/premium"].accepts,
          unpaidResponseBody: () => ({ contentType: "application/json", body: {} }),
        },
      };
      expect(() => x402({ routes: routesWithFn as never, facilitator: validFacilitator })).toThrow(
        /function/,
      );
    });

    it("accepts a valid options object", () => {
      expect(() => x402({ routes: validRoutes, facilitator: validFacilitator })).not.toThrow();
    });
  });

  describe("astro:config:setup", () => {
    let integration: ReturnType<typeof x402>;

    beforeEach(() => {
      integration = x402({ routes: validRoutes, facilitator: validFacilitator });
    });

    it("registers under the name 'astro-x402'", () => {
      expect(integration.name).toBe("astro-x402");
    });

    it("writes middleware.mjs into the codegen dir and registers it", () => {
      const { addMiddleware, codegenDir } = runSetupHook(integration);

      expect(addMiddleware).toHaveBeenCalledTimes(1);
      const call = addMiddleware.mock.calls[0][0];
      expect(call.order).toBe("pre");
      expect(call.entrypoint).toBeInstanceOf(URL);
      expect(call.entrypoint.href).toBe(new URL("./middleware.mjs", codegenDir).href);

      const generated = readFileSync(call.entrypoint, "utf8");
      expect(generated).toContain("paymentMiddleware");
      expect(generated).toContain("HTTPFacilitatorClient");
      expect(generated).toContain("x402ResourceServer");
      expect(generated).toContain("/api/premium");
      expect(generated).toContain("https://x402.org/facilitator");
      expect(generated).toContain("@x402/evm/exact/server");
      expect(generated).toContain('"eip155:*"');
    });

    it("respects the order option", () => {
      const post = x402({
        routes: validRoutes,
        facilitator: validFacilitator,
        order: "post",
      });
      const { addMiddleware } = runSetupHook(post);
      expect(addMiddleware.mock.calls[0][0].order).toBe("post");
    });
  });

  describe("renderGeneratedMiddleware", () => {
    it("emits a syntactically plausible ESM module", () => {
      const src = renderGeneratedMiddleware({
        routes: validRoutes,
        facilitator: [validFacilitator],
        paywallConfig: { appName: "Test" } as never,
        syncFacilitatorOnStart: true,
      });

      expect(src).toContain('import { paymentMiddleware } from "astro-x402"');
      expect(src).toContain(
        'import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server"',
      );
      expect(src).toContain("export const onRequest");
      expect(src).toContain('"appName":"Test"');
    });

    it("auto-registers EVM scheme for eip155 routes", () => {
      const src = renderGeneratedMiddleware({
        routes: validRoutes,
        facilitator: [validFacilitator],
        syncFacilitatorOnStart: true,
      });
      expect(src).toContain('await import("@x402/evm/exact/server")');
      expect(src).toContain("new m.ExactEvmScheme()");
      expect(src).toContain('"eip155:*"');
      expect(src).not.toContain("@x402/svm");
    });

    it("auto-registers SVM scheme for solana routes", () => {
      const src = renderGeneratedMiddleware({
        routes: {
          "/api/sol": {
            accepts: {
              scheme: "exact",
              network: "solana:devnet",
              payTo: "abc",
              price: "$0.10",
            },
          },
        } as never,
        facilitator: [validFacilitator],
        syncFacilitatorOnStart: true,
      });
      expect(src).toContain('await import("@x402/svm/exact/server")');
      expect(src).toContain("new m.ExactSvmScheme()");
      expect(src).toContain('"solana:*"');
      expect(src).not.toContain("@x402/evm");
    });

    it("registers both namespaces when routes mix them", () => {
      const src = renderGeneratedMiddleware({
        routes: {
          "/api/eth": validRoutes["/api/premium"],
          "/api/sol": {
            accepts: {
              scheme: "exact",
              network: "solana:devnet",
              payTo: "abc",
              price: "$0.10",
            },
          },
        } as never,
        facilitator: [validFacilitator],
        syncFacilitatorOnStart: true,
      });
      expect(src).toContain("@x402/evm/exact/server");
      expect(src).toContain("@x402/svm/exact/server");
    });

    it("emits a comment for unknown namespaces instead of throwing at config time", () => {
      const src = renderGeneratedMiddleware({
        routes: {
          "/api/wat": {
            accepts: {
              scheme: "exact",
              network: "newchain:1",
              payTo: "abc",
              price: "$0.10",
            },
          },
        } as never,
        facilitator: [validFacilitator],
        syncFacilitatorOnStart: true,
      });
      expect(src).toContain('namespace "newchain" has no auto-registration');
    });

    it("detectNamespaces extracts CAIP-2 namespaces from routes", () => {
      expect(
        detectNamespaces({
          "/a": { accepts: { scheme: "exact", network: "eip155:84532", payTo: "x", price: "$1" } },
        } as never),
      ).toEqual(["eip155"]);

      expect(
        detectNamespaces({
          "/a": {
            accepts: [
              { scheme: "exact", network: "eip155:8453", payTo: "x", price: "$1" },
              { scheme: "exact", network: "solana:devnet", payTo: "y", price: "$1" },
            ],
          },
        } as never),
      ).toEqual(["eip155", "solana"]);
    });

    it("emits createAuthHeaders only when headers are provided", () => {
      const withHeaders = renderGeneratedMiddleware({
        routes: validRoutes,
        facilitator: [{ url: "https://f.example", headers: { "x-api-key": "k" } }],
        syncFacilitatorOnStart: true,
      });
      expect(withHeaders).toContain("createAuthHeaders");

      const withoutHeaders = renderGeneratedMiddleware({
        routes: validRoutes,
        facilitator: [validFacilitator],
        syncFacilitatorOnStart: true,
      });
      // Both branches exist in the generated code, but the headers value
      // should only appear when set.
      expect(withoutHeaders).not.toContain("x-api-key");
    });
  });
});
