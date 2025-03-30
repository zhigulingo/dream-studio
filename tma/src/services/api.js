// tma/src/services/api.js
import axios from 'axios';

// Используем переменную окружения Vite. Если она не задана,
// можно использовать относительный путь как запасной вариант (хотя в вашем случае он не сработает).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Логируем URL, чтобы убедиться, что переменная прочиталась
console.log('Using API Base URL:', API_BASE_URL);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Перехватчик запросов для добавления initData (остается без изменений)
apiClient.interceptors.request.use(
  (config) => {
    if (window.Telegram?.WebApp?.initData) {
      config.headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData;
      console.log("Sending InitData header");
    } else {
        console.warn("Telegram WebApp initData not available.");
        // Важно: Если initData нет, запрос все равно уйдет, но бэкенд вернет 401.
        // Можно добавить прерывание запроса здесь при необходимости.
        // return Promise.reject(new Error("Missing Telegram InitData"));
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default {
  getUserProfile() {
    // Путь теперь будет конкатенироваться с полным базовым URL
    return apiClient.get('/user-profile');
  },
  getAnalysesHistory() {
    return apiClient.get('/analyses-history');
  },
  // ... другие методы ...
};
