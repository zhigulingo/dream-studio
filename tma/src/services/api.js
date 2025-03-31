// tma/src/services/api.js
import axios from 'axios';

const API_BASE_URL = 'https://sparkling-cupcake-940504.netlify.app/.netlify/functions';
console.log('--- USING HARDCODED API Base URL for test ---:', API_BASE_URL);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Перехватчик запросов для добавления initData
apiClient.interceptors.request.use(
  (config) => {
    if (window.Telegram?.WebApp?.initData) {
      config.headers['X-Telegram-Init-Data'] = window.Telegram.WebApp.initData;
      // console.log("Sending InitData header"); // Можно закомментировать для продакшена
    } else {
        console.warn("Telegram WebApp initData not available. API calls might fail.");
        // Можно раскомментировать, чтобы прервать запрос без initData
        // return Promise.reject(new Error("Missing Telegram InitData for API request"));
    }
    return config;
  },
  (error) => {
    // Можно добавить обработку ошибок запроса здесь
    console.error("Axios request interceptor error:", error);
    return Promise.reject(error);
  }
);

// Перехватчик ответов (опционально, для централизованной обработки ошибок)
apiClient.interceptors.response.use(
  (response) => {
    // Все статусы 2xx попадают сюда
    return response;
  },
  (error) => {
    // Все статусы НЕ 2xx попадают сюда
    console.error('Axios response error:', error.response || error.message || error);
    // Можно выбросить ошибку дальше, чтобы ее ловил .catch() в сторе
    // Или вернуть предопределенный объект ошибки
    return Promise.reject(error);
  }
);


export default {
  getUserProfile() {
    return apiClient.get('/user-profile');
  }, // <--- Запятая

  getAnalysesHistory() {
    return apiClient.get('/analyses-history');
  }, // <--- Запятая

  createInvoiceLink(plan, duration, amount, payload) {
    return apiClient.post('/create-invoice', { // Используем POST
        plan,
        duration,
        amount,
        payload
    });
    // Нет запятой после последнего метода
  }
}; // <--- Закрытие export default
