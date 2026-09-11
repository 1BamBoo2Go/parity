// Minimal, boring ESLint config — recommended TS rules only. Not over-architected.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "evidence/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // We deliberately use `any` in zero places; if one shows up, fail loudly.
      "@typescript-eslint/no-explicit-any": "error",
      // Unused vars are almost always a real bug in this codebase's small surface area.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
