// Adapted from @x402/hono for Astro middleware and Request/Response APIs.

import type {
  HTTPRequestContext,
  PaywallConfig,
  PaywallProvider,
  RoutesConfig,
  FacilitatorClient,
  SettlementOverrides,
} from "@x402/core/server";
import type { SchemeNetworkServer, Network } from "@x402/core/types";
import type { APIContext, MiddlewareHandler } from "astro";

import {
  x402HTTPResourceServer,
  x402ResourceServer,
  FacilitatorResponseError,
  getFacilitatorResponseError,
  SETTLEMENT_OVERRIDES_HEADER,
  checkIfBazaarNeeded,
} from "@x402/core/server";

import { AstroAdapter } from "./adapter";

/**
 * Set settlement overrides on the response for partial settlement.
 * The middleware will extract these before settlement and strip the header from the client response.
 *
 * @param res - Response returned from the Astro route handler.
 * @param overrides - Settlement overrides (e.g., { amount: "500" } for partial settlement).
 */
export function setSettlementOverrides(res: Response, overrides: SettlementOverrides): void {
  res.headers.set(SETTLEMENT_OVERRIDES_HEADER, JSON.stringify(overrides));
}

/**
 * Configuration for registering a payment scheme with a specific network.
 */
export interface SchemeRegistration {
  /**
   * The network identifier (e.g., 'eip155:84532', 'solana:mainnet').
   */
  network: Network;

  /**
   * The scheme server implementation for this network.
   */
  server: SchemeNetworkServer;
}

/**
 * Builds a normalized 502 response for facilitator boundary failures.
 *
 * @param error - The facilitator response error to surface.
 * @returns A JSON 502 Response.
 */
function facilitatorErrorResponse(error: FacilitatorResponseError): Response {
  return new Response(JSON.stringify({ error: error.message }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Builds a Response from `HTTPResponseInstructions` returned by the core library.
 *
 * @param instructions - The response instructions emitted by `processHTTPRequest`.
 * @param instructions.status - HTTP status code to use.
 * @param instructions.headers - Headers to include on the response.
 * @param instructions.body - Response body (string for HTML, object/string for JSON).
 * @param instructions.isHtml - Whether `body` is HTML or JSON-serializable.
 * @returns A `Response` with the appropriate status, headers, and body.
 */
function instructionsToResponse(instructions: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  isHtml?: boolean;
}): Response {
  const headers = new Headers(instructions.headers);
  if (instructions.isHtml) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/html");
    }
    return new Response(typeof instructions.body === "string" ? instructions.body : "", {
      status: instructions.status,
      headers,
    });
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(instructions.body ?? {}), {
    status: instructions.status,
    headers,
  });
}

/**
 * Astro payment middleware for x402 protocol (direct HTTP server instance).
 *
 * Use this when you need to configure HTTP-level hooks.
 *
 * @param httpServer - Pre-configured x402HTTPResourceServer instance.
 * @param paywallConfig - Optional configuration for the built-in paywall UI.
 * @param paywall - Optional custom paywall provider (overrides default).
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true).
 * @returns Astro middleware handler.
 *
 * @example
 * ```typescript
 * import { paymentMiddlewareFromHTTPServer, x402ResourceServer, x402HTTPResourceServer } from "astro-x402";
 *
 * const resourceServer = new x402ResourceServer(facilitatorClient)
 *   .register(NETWORK, new ExactEvmScheme());
 *
 * const httpServer = new x402HTTPResourceServer(resourceServer, routes)
 *   .onProtectedRequest(requestHook);
 *
 * export const onRequest = paymentMiddlewareFromHTTPServer(httpServer);
 * ```
 */
export function paymentMiddlewareFromHTTPServer(
  httpServer: x402HTTPResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): MiddlewareHandler {
  // Register custom paywall provider if provided
  if (paywall) {
    httpServer.registerPaywallProvider(paywall);
  }

  // Store initialization promise (not the result)
  // httpServer.initialize() fetches facilitator support and validates routes
  let initPromise: Promise<void> | null = syncFacilitatorOnStart ? httpServer.initialize() : null;
  let isInitialized = false;

  /**
   * Ensures facilitator initialization succeeds once, while allowing retries after failures.
   *
   * @returns A promise that resolves once initialization has succeeded (or is skipped).
   */
  async function initializeHttpServer(): Promise<void> {
    if (!syncFacilitatorOnStart || isInitialized) {
      return;
    }

    if (!initPromise) {
      initPromise = httpServer.initialize();
    }

    try {
      await initPromise;
      isInitialized = true;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  }

  // Dynamically register bazaar extension if routes declare it and not already registered
  // Skip if pre-registered (e.g., in serverless environments where static imports are used)
  let bazaarPromise: Promise<void> | null = null;
  if (checkIfBazaarNeeded(httpServer.routes) && !httpServer.server.hasExtension("bazaar")) {
    bazaarPromise = import("@x402/extensions/bazaar")
      .then(({ bazaarResourceServerExtension }) => {
        httpServer.server.registerExtension(bazaarResourceServerExtension);
      })
      .catch((err) => {
        console.error("Failed to load bazaar extension:", err);
      });
  }

  return async (ctx, next) => {
    const apiCtx = ctx as APIContext;
    const adapter = new AstroAdapter(apiCtx);
    const context: HTTPRequestContext = {
      adapter,
      path: apiCtx.url.pathname,
      method: apiCtx.request.method,
      paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
    };

    // Check if route requires payment before initializing facilitator
    if (!httpServer.requiresPayment(context)) {
      return next();
    }

    // Only initialize when processing a protected route
    if (syncFacilitatorOnStart && !isInitialized) {
      try {
        await initializeHttpServer();
      } catch (error) {
        const facilitatorError = getFacilitatorResponseError(error);
        if (facilitatorError) {
          return facilitatorErrorResponse(facilitatorError);
        }
        throw error;
      }
    }

    // Await bazaar extension loading if needed
    if (bazaarPromise) {
      await bazaarPromise;
      bazaarPromise = null;
    }

    // Process payment requirement check
    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      result = await httpServer.processHTTPRequest(context, paywallConfig);
    } catch (error) {
      if (error instanceof FacilitatorResponseError) {
        return facilitatorErrorResponse(error);
      }
      throw error;
    }

    // Handle the different result types
    switch (result.type) {
      case "no-payment-required":
        // No payment needed, proceed directly to the route handler
        return next();

      case "payment-error":
        // Payment required but not provided or invalid
        return instructionsToResponse(result.response);

      case "payment-verified": {
        // Payment is valid, need to wrap response for settlement.
        // NOTE: When @x402/core publishes the PaymentCancellationDispatcher API,
        // this branch should also call `cancellationDispatcher.cancel(...)` for
        // handler_threw / handler_failed (see @x402/hono for the reference).
        const { paymentPayload, paymentRequirements, declaredExtensions } = result;

        // Proceed to the next middleware or route handler
        const res: Response = await next();

        // If the response from the protected route is >= 400, do not settle payment
        if (res.status >= 400) {
          return res;
        }

        // Get response body for extensions
        const responseBody = Buffer.from(await res.clone().arrayBuffer());

        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        try {
          const settleResult = await httpServer.processSettlement(
            paymentPayload,
            paymentRequirements,
            declaredExtensions,
            { request: context, responseBody, responseHeaders },
          );

          if (!settleResult.success) {
            // Settlement failed - do not return the protected resource
            return instructionsToResponse(settleResult.response);
          }

          // Settlement succeeded - return a new response with the original body
          // and the original headers + settlement headers, with the settlement
          // overrides header stripped from the client response.
          const newHeaders = new Headers(res.headers);
          newHeaders.delete(SETTLEMENT_OVERRIDES_HEADER);
          Object.entries(settleResult.headers).forEach(([key, value]) => {
            newHeaders.set(key, value);
          });
          return new Response(responseBody, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders,
          });
        } catch (error) {
          if (error instanceof FacilitatorResponseError) {
            return facilitatorErrorResponse(error);
          }
          console.error(error);
          // If settlement fails, return an error response
          return new Response(JSON.stringify({}), {
            status: 402,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }
  };
}

/**
 * Astro payment middleware for x402 protocol (direct server instance).
 *
 * Use this when you want to pass a pre-configured x402ResourceServer instance.
 * This provides more flexibility for testing, custom configuration, and reusing
 * server instances across multiple middlewares.
 *
 * @param routes - Route configurations for protected endpoints.
 * @param server - Pre-configured x402ResourceServer instance.
 * @param paywallConfig - Optional configuration for the built-in paywall UI.
 * @param paywall - Optional custom paywall provider (overrides default).
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true).
 * @returns Astro middleware handler.
 *
 * @example
 * ```typescript
 * import { paymentMiddleware } from "astro-x402";
 *
 * const server = new x402ResourceServer(myFacilitatorClient)
 *   .register(NETWORK, new ExactEvmScheme());
 *
 * export const onRequest = paymentMiddleware(routes, server, paywallConfig);
 * ```
 */
export function paymentMiddleware(
  routes: RoutesConfig,
  server: x402ResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): MiddlewareHandler {
  // Create the x402 HTTP server instance with the resource server
  const httpServer = new x402HTTPResourceServer(server, routes);

  return paymentMiddlewareFromHTTPServer(
    httpServer,
    paywallConfig,
    paywall,
    syncFacilitatorOnStart,
  );
}

/**
 * Astro payment middleware for x402 protocol (configuration-based).
 *
 * Use this when you want to quickly set up middleware with simple configuration.
 * This function creates and configures the x402ResourceServer internally.
 *
 * @param routes - Route configurations for protected endpoints.
 * @param facilitatorClients - Optional facilitator client(s) for payment processing.
 * @param schemes - Optional array of scheme registrations for server-side payment processing.
 * @param paywallConfig - Optional configuration for the built-in paywall UI.
 * @param paywall - Optional custom paywall provider (overrides default).
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true).
 * @returns Astro middleware handler.
 *
 * @example
 * ```typescript
 * import { paymentMiddlewareFromConfig } from "astro-x402";
 *
 * export const onRequest = paymentMiddlewareFromConfig(
 *   routes,
 *   myFacilitatorClient,
 *   [{ network: "eip155:8453", server: evmSchemeServer }],
 *   paywallConfig
 * );
 * ```
 */
export function paymentMiddlewareFromConfig(
  routes: RoutesConfig,
  facilitatorClients?: FacilitatorClient | FacilitatorClient[],
  schemes?: SchemeRegistration[],
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): MiddlewareHandler {
  const ResourceServer = new x402ResourceServer(facilitatorClients);

  if (schemes) {
    schemes.forEach(({ network, server: schemeServer }) => {
      ResourceServer.register(network, schemeServer);
    });
  }

  // Use the direct paymentMiddleware with the configured server
  // Note: paymentMiddleware handles dynamic bazaar registration
  return paymentMiddleware(routes, ResourceServer, paywallConfig, paywall, syncFacilitatorOnStart);
}

export { x402 } from "./integration";
export type {
  X402IntegrationOptions,
  IntegrationFacilitatorConfig,
  JsonSafeRouteConfig,
  JsonSafeRoutesConfig,
} from "./integration";
export { default } from "./integration";

export { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";

export type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  Network,
  SchemeNetworkServer,
} from "@x402/core/types";

export type { PaywallProvider, PaywallConfig, SettlementOverrides } from "@x402/core/server";

export { RouteConfigurationError, SETTLEMENT_OVERRIDES_HEADER } from "@x402/core/server";

export type { RouteValidationError } from "@x402/core/server";

export { AstroAdapter } from "./adapter";
