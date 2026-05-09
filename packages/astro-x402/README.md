# astro-x402

Astro middleware integration for the [x402 Payment Protocol](https://github.com/x402-foundation/x402). This package provides a simple middleware function for adding x402 payment requirements to your Astro applications.

> **Note**: This package is an unofficial, third-party Astro adapter for x402. It is derived from [`@x402/hono`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/hono) and follows the same architectural patterns as the other framework adapters in the upstream repository. Both this package and the upstream x402 codebase are licensed under Apache-2.0.

## Installation

```bash
pnpm add astro-x402 @x402/core
# Optional: install the paywall UI
pnpm add @x402/paywall
```

## Requirements

- **Astro `>=4.13`** with **on-demand rendering enabled** (`output: "server"` or `output: "hybrid"` and `prerender = false` on protected routes). x402 middleware requires SSR because payment verification and settlement happen at request time.

## Quick Start

`src/middleware.ts`:

```typescript
import { paymentMiddleware, x402ResourceServer } from "astro-x402";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient({ url: "https://facilitator.x402.org" });
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
- For Cloudflare/Vercel edge adapters, `Buffer` is required (the `@x402/core` settlement extension reads the response body as a `Buffer`). Enable Node.js compatibility on your adapter.

## License

[Apache-2.0](./LICENSE) — see [`NOTICE`](./NOTICE) for attribution.
