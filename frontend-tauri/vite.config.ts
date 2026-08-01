import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const fluxoraBuildDate = process.env.FLUXORA_BUILD_DATE ?? new Date().toISOString();
const listProfilingBuild = process.env.FLUXORA_LIST_PROFILING === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fluxora-icons': fileURLToPath(new URL('../Icons', import.meta.url)),
      '@fluxora-legal': fileURLToPath(new URL('../legal/desktop', import.meta.url)),
      ...(listProfilingBuild
        ? {
            'react-dom/client': 'react-dom/profiling'
          }
        : {})
    }
  },
  define: {
    'import.meta.env.VITE_FLUXORA_BUILD_DATE': JSON.stringify(fluxoraBuildDate)
  },
  clearScreen: false
});
