import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@fluxora-icons': fileURLToPath(new URL('../Icons', import.meta.url)),
      '@fluxora-legal': fileURLToPath(new URL('../legal/desktop', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: true,
    environment: 'node'
  }
});

