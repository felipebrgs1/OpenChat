import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const repoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  envDir: repoRoot,
  server: {
    port: 5173,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
  build: {
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        // Vite 8 + Rolldown (Oxc) — usa Rolldown nativo, não Rollup.
        // advancedChunks foi renomeado para codeSplitting no Rolldown 1.x.
        // docs: https://rolldown.rs/reference/output-options#codesplitting
        codeSplitting: {
          // só cria chunk compartilhado se usado em >= 2 chunks ou for vendor grande
          minShareCount: 1,
          minSize: 20_000,
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "tanstack-router",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]react-router[\\/]/,
            },
            {
              name: "tanstack-query",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
            },
            {
              // fallback p/ outros @tanstack (devtools etc — mas devtools não deve ir p/ prod)
              name: "tanstack",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
            },
            {
              // react-markdown + ecossistema micromark/remark/unified é pesado (145kB)
              // isola em chunk próprio e permite lazy no componente
              name: "markdown",
              test: /[\\/]node_modules[\\/](react-markdown|remark|unified|micromark|mdast-util|hast-util|unist-util|vfile|bail|trough|decode-named-character|character-entities|devlop|estree-util)[\\/]/,
            },
            {
              name: "radix-baseui",
              test: /[\\/]node_modules[\\/](@base-ui|@radix-ui)[\\/]/,
            },
            {
              // workspace @nexo/ui (não está em node_modules)
              name: "nexo-ui",
              test: /[\\/]packages[\\/]ui[\\/]/,
            },
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/]/,
            },
          ],
        },
      },
    },
  },
});
