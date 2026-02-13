import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: `http://${process.env.VITE_API_HOST || 'localhost'}:5000`,
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: `http://${process.env.VITE_API_HOST || 'localhost'}:5000`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    // rollupOptions: {
    //   output: {
    //     manualChunks: {
    //       vendor: ['react', 'react-dom', 'react-router-dom', 'axios', 'recharts', 'lucide-react'],
    //       xlsx: ['xlsx'],
    //       qrcode: ['html5-qrcode']
    //     }
    //   }
    // }
  }
})
