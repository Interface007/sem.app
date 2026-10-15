import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources, so tests need no
// prior build. Vitest runs in Vite's SSR environment, hence `ssr.resolve`.
const conditions = ['@sem/source'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
