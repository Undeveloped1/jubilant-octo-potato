import { defineConfig } from 'vite';

// GitHub Pages project site: https://undeveloped1.github.io/jubilant-octo-potato/
const pagesBase = '/jubilant-octo-potato/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? pagesBase : '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    open: false
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'tests/**/*.test.js']
  }
}));
