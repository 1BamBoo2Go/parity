import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, vitest's default include glob also picks up the
    // tsc-compiled copies of the same tests under dist/, running everything
    // twice. We want exactly one source of truth: the TypeScript sources.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
