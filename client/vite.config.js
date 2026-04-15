import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Default 127.0.0.1 avoids IPv6 (::1) vs IPv4 listen mismatches that show up as ECONNREFUSED on some Linux setups.
const apiHost = (globalThis.process && globalThis.process.env && globalThis.process.env.VITE_API_HOST) || '127.0.0.1'
const apiPort = (globalThis.process && globalThis.process.env && globalThis.process.env.VITE_API_PORT) || '5000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
        secure: false,
        // Large backup downloads through dev proxy (avoid timeouts / "Network Error" on big files)
        timeout: 4 * 60 * 60 * 1000,
        proxyTimeout: 4 * 60 * 60 * 1000
      },
      '/uploads': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/healthz': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/readyz': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('exceljs')) return 'vendor-exceljs';
          if (id.includes('apexcharts') || id.includes('react-apexcharts')) return 'vendor-apexcharts';
          if (id.includes('recharts')) return 'vendor-recharts';
          if (id.includes('html2canvas') || id.includes('jspdf')) return 'vendor-pdf-canvas';
          if (id.includes('html5-qrcode')) return 'vendor-html5-qrcode';
          if (id.includes('lucide-react')) return 'vendor-lucide';
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'vendor-react';
          if (id.includes('axios')) return 'vendor-axios';
        }
      }
    }
  }
})
