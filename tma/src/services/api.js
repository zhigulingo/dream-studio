// tma/src/services/api.js
import axios from 'axios'; // Установите axios, если еще не: npm install axios

// Базовый URL для ваших Netlify Functions
// Обычно это URL вашего сайта Netlify + /.netlify/functions/
// Можно вынести в .env
const API_BASE_URL = '/.netlify/functions'; // Относительный путь работает, если TMA на том же домене

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Перехватчик запросов для добавления initData
apiClient.interceptors.request.use(
  (config) => {
    // Проверяем, доступен ли объект Telegram WebApp
    if (window.Telegram?.WebApp?.initData) {
      config.headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData;
      console.log("Sending InitData header"); // Для отладки
    } else {
        console.warn("Telegram WebApp initData not available.");
        // В идеале, здесь нужно предотвращать запрос или обрабатывать ошибку,
        // так как без initData API не авторизует пользователя.
        // Пока просто выводим предупреждение.
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default {
  getUserProfile() {
    return apiClient.get('/user-profile');
  },
  getAnalysesHistory() {
    return apiClient.get('/analyses-history');
  },
  // Здесь будут другие методы API, например, для создания ссылки на оплату
  // createInvoiceLink(plan, duration) { ... }
};
