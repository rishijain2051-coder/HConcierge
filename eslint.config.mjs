import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are whole copies of this repo, `.next` and all, and the
    // ignores above are anchored to this file — so a single worktree buried
    // two real errors under twelve thousand of its own.
    ".claude/**",
  ]),
]);

export default eslintConfig;
