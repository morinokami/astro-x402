# astro-x402

Astro integration for the [x402 Payment Protocol](https://github.com/x402-foundation/x402). Add payment requirements to your Astro app either declaratively via an [Astro integration](https://docs.astro.build/en/reference/integrations-reference/) in `astro.config.ts`, or programmatically via a middleware factory in `src/middleware.ts` for advanced cases.

> **Note**: This package is an unofficial, third-party Astro adapter for x402. It is derived from [`@x402/hono`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/hono) and follows the same architectural patterns as the other framework adapters in the upstream repository. Both this package and the upstream x402 codebase are licensed under Apache-2.0.

## Installation

```bash
pnpm add astro-x402 @x402/core
# Plus the scheme package(s) for the networks you accept:
pnpm add @x402/evm   # EVM networks (eip155:*)
pnpm add @x402/svm   # Solana networks (solana:*)
# Optional: install the paywall UI
pnpm add @x402/paywall
```

## Requirements

- **Astro `>=5.0`** with **on-demand rendering enabled** (`output: "server"` or `output: "hybrid"` and `prerender = false` on protected routes). Your Astro app must be configured for SSR with an adapter, such as `@astrojs/node`, because payment verification and settlement happen at request time.

## Integration mode

Configure everything from `astro.config.ts`:

```ts
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import x402 from "astro-x402";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    x402({
      routes: {
        "/api/premium": {
          accepts: {
            scheme: "exact",
            price: "$0.10",
            network: "eip155:84532",
            payTo: "0xYourAddress",
          },
          description: "Access to premium content",
        },
      },
      facilitator: { url: "https://x402.org/facilitator" },
    }),
  ],
});
```

The integration walks your `routes`, detects which CAIP-2 namespaces are used (`eip155`, `solana`), and dynamically registers the corresponding scheme servers from `@x402/evm` / `@x402/svm`. No `src/middleware.ts` is required.

### Integration options

```ts
x402({
  routes,                  // required — JSON-serializable RouteConfig record
  facilitator?,            // { url, headers? } or array — default: https://x402.org/facilitator
  paywallConfig?,          // same shape as PaywallConfig
  syncFacilitatorOnStart?, // default: true
  order?,                  // "pre" | "post" — default: "pre"
})
```

If `facilitator` is omitted the integration falls back to the public x402 facilitator (`https://x402.org/facilitator`) and emits an info log line so the default is visible at startup. Set it explicitly in production to make the trust boundary auditable and to avoid silent failures if the public endpoint changes or is unavailable.

### When integration mode is not enough

Drop to middleware mode (next section) when you need any of these — they cannot be expressed in `astro.config`:

- Custom `unpaidResponseBody` / `settlementFailedResponseBody` callbacks
- Custom `PaywallProvider` or `onProtectedRequest` hooks
- A signer-backed or non-HTTP `FacilitatorClient`
- A custom `SchemeNetworkServer` (e.g., a non-default EVM signer)
- Settlement overrides for the `upto` scheme

The integration's type for `routes` (`JsonSafeRoutesConfig`) excludes the callback fields at compile time, with a runtime fail-safe check as defense-in-depth.

## Middleware mode

For full programmatic control, write `src/middleware.ts` directly:

```typescript
import { paymentMiddleware, x402ResourceServer } from "astro-x402";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:84532",
  new ExactEvmScheme(),
);

export const onRequest = paymentMiddleware(
  {
    "GET /protected-route": {
      accepts: {
        scheme: "exact",
        price: "$0.10",
        network: "eip155:84532",
        // Replace with your receiving EVM wallet address.
        payTo: "0xYourAddress",
      },
      description: "Access to premium content",
    },
  },
  resourceServer,
);
```

`src/pages/protected-route.ts`:

```typescript
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ message: "This content is behind a paywall" }), {
    headers: { "Content-Type": "application/json" },
  });
```

## Combining with other middleware

Use Astro's `sequence()` helper:

```typescript
import { defineMiddleware, sequence } from "astro:middleware";
import { paymentMiddleware } from "astro-x402";

const auth = defineMiddleware(async (ctx, next) => {
  // ... your auth logic
  return next();
});

export const onRequest = sequence(auth, paymentMiddleware(routes, resourceServer));
```

## Configuration

The `paymentMiddleware` function accepts the following parameters:

```typescript
paymentMiddleware(
  routes: RoutesConfig,
  server: x402ResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart?: boolean,
)
```

### Parameters

1. **`routes`** (required): Route configurations for protected endpoints.
2. **`server`** (required): Pre-configured `x402ResourceServer` instance.
3. **`paywallConfig`** (optional): Configuration for the built-in paywall UI.
4. **`paywall`** (optional): Custom paywall provider.
5. **`syncFacilitatorOnStart`** (optional): Whether to sync with the facilitator on startup (defaults to `true`).

## API Reference

### `AstroAdapter`

The `AstroAdapter` class implements the `HTTPAdapter` interface from `@x402/core`, wrapping Astro's `APIContext`:

```typescript
class AstroAdapter implements HTTPAdapter {
  getHeader(name: string): string | undefined;
  getMethod(): string;
  getPath(): string;
  getUrl(): string;
  getAcceptHeader(): string;
  getUserAgent(): string;
  getQueryParams(): Record<string, string | string[]>;
  getQueryParam(name: string): string | string[] | undefined;
  getBody(): Promise<unknown>;
}
```

### Variants

Three factory functions are exposed, mirroring `@x402/hono`:

- `paymentMiddleware(routes, server, paywallConfig?, paywall?, syncFacilitatorOnStart?)`
- `paymentMiddlewareFromHTTPServer(httpServer, paywallConfig?, paywall?, syncFacilitatorOnStart?)`
- `paymentMiddlewareFromConfig(routes, facilitatorClients?, schemes?, paywallConfig?, paywall?, syncFacilitatorOnStart?)`

### `setSettlementOverrides`

For partial settlement (`upto` scheme), set settlement overrides on the response returned from your route handler:

```typescript
import { setSettlementOverrides } from "astro-x402";

export const GET: APIRoute = () => {
  const res = new Response(JSON.stringify({ data: "..." }));
  setSettlementOverrides(res, { amount: "500" });
  return res;
};
```

The middleware extracts these overrides before settlement and strips the header from the client response.

## Astro-specific notes

- **`prerender = false` is required** on routes that should require payment. If a route is statically prerendered, the middleware runs at build time and the payment check has no effect at request time.
- The middleware handles both `.astro` pages and API endpoints (`src/pages/**/*.{ts,js}`) uniformly because Astro middleware is invoked for both.
- For edge adapters, this package currently uses `Buffer` when passing the response body into settlement processing. Enable Node.js compatibility or use an adapter/runtime that provides `Buffer`.

## See also

- [EmDash CMS](https://docs.emdashcms.com/guides/x402-payments/) bundles its own x402 integration (`@emdash-cms/x402`) for sites built on the EmDash CMS.

## License

[Apache-2.0](./LICENSE) — see [`NOTICE`](./NOTICE) for attribution.
