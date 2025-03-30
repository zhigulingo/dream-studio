// tma/vite.config.js
import { fileURLToPath, URL } from 'node:url' // Для настройки алиасов
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue' // Импортируем плагин Vue

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(), // <<<--- Подключаем плагин Vue
  ],
  resolve: {
    // Настройка алиаса '@' для удобного импорта из папки src
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Опционально: Настройка сервера для локальной разработки (не влияет на сборку Netlify)
  // server: {
  //   port: 5173, // Или любой другой порт
  //   open: true
  // }
})
