import { defineConfig } from "tsup";

const baseConfig = {
  banner: {
    js: "/* astro-x402 includes code adapted from @x402/hono for Astro. See NOTICE. */",
  },
  entry: {
    index: "src/index.ts",
  },
  dts: {
    resolve: true,
  },
  sourcemap: true,
  target: "node16",
};

export default defineConfig([
  {
    ...baseConfig,
    format: "esm",
    outDir: "dist/esm",
    clean: true,
  },
  {
    ...baseConfig,
    format: "cjs",
    outDir: "dist/cjs",
    clean: false,
  },
]);
