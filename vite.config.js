import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  // the JPEG XL codec loads its own .wasm files; don't let Vite pre-bundle it
  optimizeDeps: {
    exclude: ['@jsquash/jxl'],
  },
  worker: {
    format: 'es',
  },
});
