import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 👇 替換成自己的倉庫名稱
  base: "/OOXX/",
})
