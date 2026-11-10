import { defineConfig } from "vite";

// T010 CLI build: bundles src/cli.ts into dist/viewportshift.mjs
// (run as `node dist/viewportshift.mjs demo`). This is a second,
// additive build step — it must NOT wipe the web app output, so
// emptyOutDir is false and the web `vite build` runs first (see the
// `build` script in package.json). Node built-ins stay external.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/cli.ts",
      fileName: () => "viewportshift.mjs",
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: {
      external: [/^node:/],
    },
  },
});
