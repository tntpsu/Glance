import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Glance dev server. Port 5175 to avoid colliding with Pulse (5174)
// and any default Vite (5173) when both are running side by side.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
  },
})
