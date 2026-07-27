import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fluxoraBuildDate = process.env.FLUXORA_BUILD_DATE ?? new Date().toISOString();
const listProfilingBuild = process.env.FLUXORA_LIST_PROFILING === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: listProfilingBuild
      ? {
          'react-dom/client': 'react-dom/profiling'
        }
      : undefined
  },
  define: {
    'import.meta.env.VITE_FLUXORA_BUILD_DATE': JSON.stringify(fluxoraBuildDate)
  },
  clearScreen: false
});
