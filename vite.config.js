import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  preview: { proxy: {} },
  server: {
    port: 5173,
    // Backend scan progress writes must not reload the page running that scan.
    watch: { ignored: ['**/pocketbase/**'] },
    // 把 /api 代理到 PocketBase（后台 CMS），前端无跨域问题
    proxy: {
      '/ai-chat/': { target: 'http://127.0.0.1:5174', changeOrigin: true },
      '/api/pig-king': { target: 'http://127.0.0.1:8091', changeOrigin: true },
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
})
