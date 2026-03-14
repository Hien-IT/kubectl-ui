import { defineConfig } from 'vite';

export default defineConfig({
  // Prevent clearing terminal when dev server starts
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
  },
});
