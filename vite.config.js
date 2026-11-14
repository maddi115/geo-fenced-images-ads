import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

// DEV ONLY: prints the map engine stats sent by the browser into this terminal
function engineStatsToTerminal() {
  return {
    name: 'engine-stats-to-terminal',
    configureServer(server) {
      server.middlewares.use('/__engine-stats', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const time = new Date().toLocaleTimeString();
          console.log(`\x1b[36m[map stats ${time}]\x1b[0m ${body}`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), engineStatsToTerminal()],
  server: {
    port: 3000,
    // allow opening the dev server through a Cloudflare tunnel (https link for your phone)
    allowedHosts: ['.trycloudflare.com'],
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
