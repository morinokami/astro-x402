import type { RouteConfig, PaywallConfig } from "@x402/core/server";
import type { AstroIntegration } from "astro";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Route config with function-valued fields removed. Those fields require a
 * hand-written middleware because they cannot survive JSON serialization.
 */
export type JsonSafeRouteConfig = Omit<
  RouteConfig,
  "unpaidResponseBody" | "settlementFailedResponseBody"
>;

export type JsonSafeRoutesConfig = Record<string, JsonSafeRouteConfig> | JsonSafeRouteConfig;

/**
 * Facilitator configuration accepted by the integration. URL-based only;
 * use the middleware exports directly for custom FacilitatorClient implementations.
 */
export interface IntegrationFacilitatorConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface X402IntegrationOptions {
  routes: JsonSafeRoutesConfig;
  facilitator?: IntegrationFacilitatorConfig | IntegrationFacilitatorConfig[];
  paywallConfig?: PaywallConfig;
  syncFacilitatorOnStart?: boolean;
  order?: "pre" | "post";
}

/**
 * URL used when the user does not specify `facilitator`. Matches the public
 * facilitator referenced by the x402 ecosystem.
 */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * Type guard for non-array plain objects.
 *
 * @param v - Value to test.
 * @returns True if `v` is a non-null, non-array object.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Walk an object and throw if any leaf is a function. Used as the fail-safe
 * layer after the type-level `JsonSafeRoutesConfig` Omit.
 *
 * @param value - Value to inspect recursively.
 * @param path - Property path accumulated so far, for the error message.
 */
function assertNoFunctions(value: unknown, path: string): void {
  if (typeof value === "function") {
    throw new Error(
      `astro-x402: routes${path} is a function and cannot be carried through the integration. ` +
        `If you reached this with TypeScript enabled, please file an issue — the type layer should have caught it. ` +
        `Move this route to a hand-written src/middleware.ts using paymentMiddlewareFromConfig.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFunctions(v, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      assertNoFunctions(v, `${path}.${k}`);
    }
  }
}

/**
 * Validate integration options at config-load time. Throws with an actionable
 * message naming the offending field.
 *
 * @param options - The user-supplied integration options.
 */
function validateOptions(options: X402IntegrationOptions): void {
  if (!options || !options.routes) {
    throw new Error("astro-x402: `routes` is required.");
  }
  const isRecord = isPlainObject(options.routes) && !("accepts" in (options.routes as object));
  if (isRecord && Object.keys(options.routes as Record<string, unknown>).length === 0) {
    throw new Error("astro-x402: `routes` must declare at least one protected path.");
  }
  assertNoFunctions(options.routes, "");

  if (options.facilitator === undefined) {
    return;
  }
  const facilitators = Array.isArray(options.facilitator)
    ? options.facilitator
    : [options.facilitator];
  for (const [i, f] of facilitators.entries()) {
    if (!f || typeof f.url !== "string" || f.url.length === 0) {
      throw new Error(`astro-x402: facilitator[${i}].url must be a non-empty string.`);
    }
  }
}

interface SerializedConfig {
  routes: JsonSafeRoutesConfig;
  facilitator: IntegrationFacilitatorConfig[];
  paywallConfig?: PaywallConfig;
  syncFacilitatorOnStart: boolean;
}

/**
 * Map from CAIP-2 namespace to the scheme package the integration auto-registers.
 * `eip155` covers Base, Avalanche, etc.; `solana` covers SVM networks.
 */
const SCHEME_REGISTRY: Record<string, { module: string; export: string }> = {
  eip155: { module: "@x402/evm/exact/server", export: "ExactEvmScheme" },
  solana: { module: "@x402/svm/exact/server", export: "ExactSvmScheme" },
};

/**
 * Walk a routes config and collect every CAIP-2 namespace declared in any
 * `accepts` entry. Used to decide which scheme packages must be imported by
 * the generated middleware.
 *
 * @param routes - User-supplied routes (record or single RouteConfig).
 * @returns Sorted unique namespaces (e.g., `["eip155", "solana"]`).
 */
export function detectNamespaces(routes: JsonSafeRoutesConfig): string[] {
  const ns = new Set<string>();
  const visit = (route: JsonSafeRouteConfig): void => {
    const accepts = Array.isArray(route.accepts) ? route.accepts : [route.accepts];
    for (const a of accepts) {
      const network = (a as { network?: unknown }).network;
      if (typeof network === "string" && network.includes(":")) {
        ns.add(network.split(":")[0]);
      }
    }
  };
  if (isPlainObject(routes) && "accepts" in routes) {
    visit(routes as JsonSafeRouteConfig);
  } else {
    for (const route of Object.values(routes as Record<string, JsonSafeRouteConfig>)) {
      visit(route);
    }
  }
  return [...ns].sort();
}

/**
 * Render the ESM source for the generated middleware file. Exported for tests.
 *
 * @param cfg - Validated and defaulted integration configuration.
 * @returns ESM source code that exports an `onRequest` middleware.
 */
export function renderGeneratedMiddleware(cfg: SerializedConfig): string {
  const literal = JSON.stringify(cfg);
  const namespaces = detectNamespaces(cfg.routes);

  const schemeRegistrations = namespaces
    .map((ns) => {
      const reg = SCHEME_REGISTRY[ns];
      if (!reg) {
        // Unknown namespace — emit a runtime error so the user knows the
        // integration cannot auto-register a scheme for it.
        return `  // namespace "${ns}" has no auto-registration mapping in astro-x402.
  // If your facilitator handles "${ns}:*" without local scheme logic, you can
  // ignore this; otherwise switch to src/middleware.ts and register the scheme
  // server yourself via x402ResourceServer.register("${ns}:*", ...).`;
      }
      return `  try {
    const m = await import(${JSON.stringify(reg.module)});
    server.register("${ns}:*", new m.${reg.export}());
  } catch (err) {
    throw new Error(
      "astro-x402: routes declare network namespace \\"${ns}:*\\" but ${reg.module} could not be loaded. " +
        "Install the package or remove routes that target ${ns}:* networks. " +
        "Underlying error: " + (err && err.message ? err.message : String(err)),
    );
  }`;
    })
    .join("\n");

  return `/* Generated by astro-x402 integration. Do not edit. */
import { paymentMiddleware } from "astro-x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";

const cfg = ${literal};

const facilitators = cfg.facilitator.map((f) => {
  if (f.headers) {
    const headers = f.headers;
    return new HTTPFacilitatorClient({
      url: f.url,
      createAuthHeaders: async () => ({
        verify: headers,
        settle: headers,
        supported: headers,
      }),
    });
  }
  return new HTTPFacilitatorClient({ url: f.url });
});

const server = new x402ResourceServer(facilitators);

${schemeRegistrations}

export const onRequest = paymentMiddleware(
  cfg.routes,
  server,
  cfg.paywallConfig,
  undefined,
  cfg.syncFacilitatorOnStart,
);
`;
}

/**
 * Astro integration for the x402 payment protocol.
 *
 * @param options - Integration options.
 * @param options.routes - Route configurations for protected endpoints. Scheme
 *   servers for the CAIP-2 namespaces declared here (`eip155:*`, `solana:*`)
 *   are registered automatically; install the matching `@x402/evm` or
 *   `@x402/svm` package. For function-valued fields like `unpaidResponseBody`,
 *   use `paymentMiddleware` in `src/middleware.ts` directly.
 * @param options.facilitator - One or more facilitator endpoints, each
 *   `{ url, headers? }`. Defaults to the public x402 facilitator at
 *   `https://x402.org/facilitator` when omitted; set explicitly in production.
 * @param options.paywallConfig - Optional configuration for the built-in paywall UI.
 * @param options.syncFacilitatorOnStart - Whether to sync with the facilitator on
 *   startup (defaults to `true`).
 * @param options.order - Middleware ordering relative to user-defined middleware
 *   (defaults to `"pre"`).
 * @returns An {@link AstroIntegration} ready to be passed to `defineConfig`.
 * @example
 * ```ts
 * // astro.config.ts
 * import x402 from "astro-x402";
 *
 * export default defineConfig({
 *   integrations: [
 *     x402({
 *       routes: {
 *         "/api/premium": {
 *           accepts: { scheme: "exact", network: "eip155:84532",
 *                      payTo: "0x...", price: "$0.10" },
 *         },
 *       },
 *       facilitator: { url: "https://x402.org/facilitator" },
 *     }),
 *   ],
 * });
 * ```
 */
export function x402(options: X402IntegrationOptions): AstroIntegration {
  validateOptions(options);

  const facilitatorDefaulted = options.facilitator === undefined;
  const facilitators: IntegrationFacilitatorConfig[] = facilitatorDefaulted
    ? [{ url: DEFAULT_FACILITATOR_URL }]
    : Array.isArray(options.facilitator)
      ? options.facilitator
      : [options.facilitator!];

  const serialized: SerializedConfig = {
    routes: options.routes,
    facilitator: facilitators,
    paywallConfig: options.paywallConfig,
    syncFacilitatorOnStart: options.syncFacilitatorOnStart ?? true,
  };

  const source = renderGeneratedMiddleware(serialized);
  const order = options.order ?? "pre";

  return {
    name: "astro-x402",
    hooks: {
      "astro:config:setup": ({ addMiddleware, createCodegenDir, logger }) => {
        if (facilitatorDefaulted) {
          logger.info(
            `no \`facilitator\` configured; defaulting to ${DEFAULT_FACILITATOR_URL}. ` +
              `Set \`facilitator\` explicitly in production.`,
          );
        }

        const dir = createCodegenDir();
        const entrypoint = new URL("./middleware.mjs", dir);
        const filePath = fileURLToPath(entrypoint);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, source);

        addMiddleware({ entrypoint, order });
      },
    },
  };
}

export default x402;
