import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fluxoraBuildDate = process.env.FLUXORA_BUILD_DATE ?? new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_FLUXORA_BUILD_DATE': JSON.stringify(fluxoraBuildDate)
  },
  clearScreen: false
});
