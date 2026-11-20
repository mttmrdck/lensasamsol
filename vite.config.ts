import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { assertBuildTarget } from './scripts/lib/release-config.mjs';

export default defineConfig(({ command }) => {
  // Fails closed before any output is generated: CI builds must select staging/production via CLOUDFLARE_ENV,
  // and those environments must have real D1 IDs, an HTTPS origin, DEMO_MODE=false and required secrets declared.
  if (command === 'build') assertBuildTarget();
  return {
    plugins: [react(), tailwindcss(), cloudflare()],
    server: { port: 5188, strictPort: true },
  };
});
