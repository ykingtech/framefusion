import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative paths make the build portable whether Auraliya.html is at the server root
  // or inside a subfolder alongside another website's index.html.
  base: './',
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: resolve(process.cwd(), 'Auraliya.html'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
