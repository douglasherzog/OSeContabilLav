import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT || process.env.DEV_PORT || 3000),
    strictPort: false,
  },
});
