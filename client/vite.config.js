import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    https: (() => {
      const certPath = path.resolve(__dirname, 'certs/localhost.pem')
      const keyPath = path.resolve(__dirname, 'certs/localhost-key.pem')
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath)
        }
      }
      return true
    })(),
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
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
