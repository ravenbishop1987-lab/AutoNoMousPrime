import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Silence ECONNREFUSED spam while the API is still booting
        configure: (proxy) => {
          proxy.on('error', () => { /* swallow until API is ready */ })
        },
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        rewriteWsOrigin: true,
        // Disable proxy timeout — LLM pipeline tasks can run for 30+ seconds
        // without traffic, which triggers ECONNRESET on the default timeout.
        timeout: 0,
        configure: (proxy) => {
          proxy.on('error', () => { /* swallow until API is ready */ })
        },
      },
      '/saas': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => { /* swallow until API is ready */ })
        },
      },
      '/outputs': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => { /* swallow until API is ready */ })
        },
      },
    },
  },
  build: {
    outDir: '../dashboard/static',
    emptyOutDir: true,
  },
})
