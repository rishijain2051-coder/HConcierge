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
    // None of the below is the product, and all of it has buried real errors
    // in this repo at least once. The rule: if `npm run lint` reports a
    // problem nobody in this codebase can fix, the path belongs here.
    //
    // Agent worktrees are whole copies of this repo, `.next` and all, and the
    // ignores above are anchored to this file — so a single worktree buried
    // two real errors under twelve thousand of its own.
    ".claude/**",
    // Skills and audit scaffolding, installed per machine. Already gitignored.
    ".agents/**",
    // The films and the social assets: browser globals loaded by script tag,
    // Node build scripts, and a vendored gsap.min.js. 64 errors, none of them
    // ours.
    "marketing/**",
  ]),
]);

export default eslintConfig;
