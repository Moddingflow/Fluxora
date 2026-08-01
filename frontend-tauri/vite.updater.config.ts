import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@fluxora-icons': fileURLToPath(new URL('../Icons', import.meta.url)),
      '@fluxora-legal': fileURLToPath(new URL('../legal/desktop', import.meta.url))
    }
  },
  build: {
    emptyOutDir: true,
    outDir: 'dist/updater',
    rollupOptions: {
      input: fileURLToPath(new URL('./updater.html', import.meta.url))
    }
  },
  clearScreen: false
});
