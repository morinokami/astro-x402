import { defineConfig } from "vite-plus";

const baseConfig = {
  banner: {
    js: "/* astro-x402 includes code adapted from @x402/hono for Astro. See NOTICE. */",
  },
  entry: {
    index: "src/index.ts",
  },
  dts: {
    tsgo: true,
  },
  sourcemap: true,
  target: "node16",
  exports: true,
};

export default defineConfig({
  pack: [
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
  ],
});
