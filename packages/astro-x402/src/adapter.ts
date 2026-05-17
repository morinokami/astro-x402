// Adapted from @x402/hono for Astro's APIContext.

import type { HTTPAdapter } from "@x402/core/server";
import type { APIContext } from "astro";

/**
 * Astro adapter implementation.
 *
 * Wraps Astro's `APIContext` (passed to middleware `onRequest` and to API
 * route handlers) to satisfy the `HTTPAdapter` interface from `@x402/core`.
 */
export class AstroAdapter implements HTTPAdapter {
  /**
   * Creates a new AstroAdapter instance.
   *
   * @param ctx - The Astro APIContext (or middleware context) object.
   */
  constructor(private ctx: APIContext) {}

  /**
   * Gets a header value from the request.
   *
   * @param name - The header name (case-insensitive).
   * @returns The header value or undefined.
   */
  getHeader(name: string): string | undefined {
    return this.ctx.request.headers.get(name) ?? undefined;
  }

  /**
   * Gets the HTTP method of the request.
   *
   * @returns The HTTP method.
   */
  getMethod(): string {
    return this.ctx.request.method;
  }

  /**
   * Gets the path of the request.
   *
   * @returns The request path.
   */
  getPath(): string {
    return this.ctx.url.pathname;
  }

  /**
   * Gets the full URL of the request.
   *
   * @returns The full request URL.
   */
  getUrl(): string {
    return this.ctx.url.toString();
  }

  /**
   * Gets the Accept header from the request.
   *
   * @returns The Accept header value or empty string.
   */
  getAcceptHeader(): string {
    return this.ctx.request.headers.get("Accept") ?? "";
  }

  /**
   * Gets the User-Agent header from the request.
   *
   * @returns The User-Agent header value or empty string.
   */
  getUserAgent(): string {
    return this.ctx.request.headers.get("User-Agent") ?? "";
  }

  /**
   * Gets all query parameters from the request URL.
   *
   * Repeated parameters are collapsed into arrays; single parameters are
   * returned as strings to match the `HTTPAdapter` contract used by the
   * other framework adapters.
   *
   * @returns Record of query parameter key-value pairs.
   */
  getQueryParams(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    const params = this.ctx.url.searchParams;
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      result[key] = values.length > 1 ? values : values[0];
    }
    return result;
  }

  /**
   * Gets a specific query parameter by name.
   *
   * @param name - The query parameter name.
   * @returns The query parameter value(s) or undefined.
   */
  getQueryParam(name: string): string | string[] | undefined {
    const params = this.ctx.url.searchParams;
    if (!params.has(name)) {
      return undefined;
    }
    const values = params.getAll(name);
    return values.length > 1 ? values : values[0];
  }

  /**
   * Gets the parsed JSON request body.
   *
   * Reads from a clone so that subsequent middleware or route handlers can
   * still consume the original request body.
   *
   * @returns The parsed request body, or undefined if the body is not JSON.
   */
  async getBody(): Promise<unknown> {
    try {
      return await this.ctx.request.clone().json();
    } catch {
      return undefined;
    }
  }
}
