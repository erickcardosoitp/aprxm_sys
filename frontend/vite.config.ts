import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT ?? '9000'}`,
        changeOrigin: true,
      },
    },
  },
})
