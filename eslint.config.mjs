import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // Build artefacts must never be linted: .netlify/ holds the packaged server
  // handler produced by the Netlify runtime during local `netlify build` runs.
  globalIgnores([
    ".next/**",
    ".netlify/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);
