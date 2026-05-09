import { describe, it, expect } from "vitest";
import type { APIContext } from "astro";
import { AstroAdapter } from "./adapter";

/**
 * Factory for creating a mock Astro APIContext.
 *
 * @param options - Configuration options for the mock context.
 * @param options.url - The request URL.
 * @param options.method - The HTTP method.
 * @param options.headers - Request headers.
 * @param options.body - JSON request body.
 * @returns A mock Astro APIContext.
 */
function createMockContext(
  options: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): APIContext {
  const url = new URL(options.url || "https://example.com/api/test");
  const init: RequestInit = {
    method: options.method || "GET",
    headers: options.headers,
  };
  if (options.body !== undefined && (options.method ?? "GET") !== "GET") {
    init.body = JSON.stringify(options.body);
    init.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  }
  const request = new Request(url.toString(), init);
  return { request, url } as unknown as APIContext;
}

describe("AstroAdapter", () => {
  describe("getHeader", () => {
    it("returns header value when present", () => {
      const ctx = createMockContext({ headers: { "X-Payment": "test-payment" } });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getHeader("x-payment")).toBe("test-payment");
    });

    it("returns undefined for missing headers", () => {
      const ctx = createMockContext();
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getHeader("X-Missing")).toBeUndefined();
    });
  });

  describe("getMethod", () => {
    it("returns the HTTP method", () => {
      const ctx = createMockContext({ method: "POST" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getMethod()).toBe("POST");
    });
  });

  describe("getPath", () => {
    it("returns the pathname", () => {
      const ctx = createMockContext({ url: "https://example.com/api/weather?city=NYC" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getPath()).toBe("/api/weather");
    });
  });

  describe("getUrl", () => {
    it("returns the full URL", () => {
      const ctx = createMockContext({ url: "https://example.com/api/test?foo=bar" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getUrl()).toBe("https://example.com/api/test?foo=bar");
    });
  });

  describe("getAcceptHeader", () => {
    it("returns Accept header when present", () => {
      const ctx = createMockContext({ headers: { Accept: "text/html" } });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getAcceptHeader()).toBe("text/html");
    });

    it("returns empty string when missing", () => {
      const ctx = createMockContext();
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getAcceptHeader()).toBe("");
    });
  });

  describe("getUserAgent", () => {
    it("returns User-Agent header when present", () => {
      const ctx = createMockContext({ headers: { "User-Agent": "Mozilla/5.0" } });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getUserAgent()).toBe("Mozilla/5.0");
    });

    it("returns empty string when missing", () => {
      const ctx = createMockContext();
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getUserAgent()).toBe("");
    });
  });

  describe("getQueryParams", () => {
    it("returns all query parameters", () => {
      const ctx = createMockContext({ url: "https://example.com/api/test?foo=bar&baz=qux" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParams()).toEqual({ foo: "bar", baz: "qux" });
    });

    it("returns empty object when no query params", () => {
      const ctx = createMockContext();
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParams()).toEqual({});
    });

    it("collapses repeated params into arrays", () => {
      const ctx = createMockContext({ url: "https://example.com/api/test?tag=a&tag=b" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParams()).toEqual({ tag: ["a", "b"] });
    });
  });

  describe("getQueryParam", () => {
    it("returns single value for single param", () => {
      const ctx = createMockContext({ url: "https://example.com/api/test?city=NYC" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParam("city")).toBe("NYC");
    });

    it("returns array for repeated param", () => {
      const ctx = createMockContext({ url: "https://example.com/api/test?tag=a&tag=b" });
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParam("tag")).toEqual(["a", "b"]);
    });

    it("returns undefined for missing param", () => {
      const ctx = createMockContext();
      const adapter = new AstroAdapter(ctx);
      expect(adapter.getQueryParam("missing")).toBeUndefined();
    });
  });

  describe("getBody", () => {
    it("returns parsed JSON body", async () => {
      const body = { data: "test" };
      const ctx = createMockContext({ method: "POST", body });
      const adapter = new AstroAdapter(ctx);
      expect(await adapter.getBody()).toEqual(body);
    });

    it("returns undefined when body parsing fails", async () => {
      const request = new Request("https://example.com/api/test", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      });
      const ctx = {
        request,
        url: new URL("https://example.com/api/test"),
      } as unknown as APIContext;
      const adapter = new AstroAdapter(ctx);
      expect(await adapter.getBody()).toBeUndefined();
    });

    it("does not consume the original request body", async () => {
      const body = { data: "test" };
      const ctx = createMockContext({ method: "POST", body });
      const adapter = new AstroAdapter(ctx);
      await adapter.getBody();
      // Original request body should still be consumable
      const consumed = await ctx.request.json();
      expect(consumed).toEqual(body);
    });
  });
});
