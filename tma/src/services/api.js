// tma/src/services/api.js
import axios from 'axios';

// Используем переменную окружения Vite. Убедитесь, что она ЗАДАНА в Netlify UI для сайта TMA
// и содержит ПОЛНЫЙ путь к функциям (включая /.netlify/functions)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Логируем URL для проверки при запуске TMA
if (!API_BASE_URL) {
    console.error("CRITICAL: VITE_API_BASE_URL is not set in environment variables!");
    alert("Ошибка конфигурации: не удалось определить адрес API.");
} else {
    console.log('[api.js] Using API Base URL:', API_BASE_URL);
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Перехватчик запросов для добавления initData
apiClient.interceptors.request.use(
  (config) => {
    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      config.headers['X-Telegram-Init-Data'] = initData;
      // console.log("[api.js] Sending InitData header");
    } else {
        console.warn("[api.js] Telegram WebApp initData not available. API calls might fail authorization.");
        // Важно: Если initData нет, бэкенд должен вернуть 401, но запрос уйдет.
        // Если хотите прервать запрос без initData, раскомментируйте строку ниже:
        // return Promise.reject(new Error("Missing Telegram InitData for API request"));
    }
    return config;
  },
  (error) => {
    console.error("[api.js] Axios request interceptor error:", error);
    return Promise.reject(error);
  }
);

// Перехватчик ответов для логирования ошибок
apiClient.interceptors.response.use(
  (response) => {
    return response; // Успешный ответ просто пропускаем
  },
  (error) => {
    // Логируем детали ошибки ответа
    console.error('[api.js] Axios response error:', {
        message: error.message,
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        data: error.response?.data,
    });
    // Пробрасываем ошибку дальше для обработки в сторе
    return Promise.reject(error);
  }
);

// Объект с методами API
const apiMethods = {
  getUserProfile() {
    console.log("[api.js] Calling getUserProfile"); // Лог вызова
    return apiClient.get('/user-profile');
  },

  getAnalysesHistory() {
    console.log("[api.js] Calling getAnalysesHistory"); // Лог вызова
    return apiClient.get('/analyses-history');
  },

  createInvoiceLink(plan, duration, amount, payload) {
     console.log("[api.js] Calling createInvoiceLink"); // Лог вызова
    return apiClient.post('/create-invoice', {
        plan,
        duration,
        amount,
        payload
    });
  }
};

// Экспортируем и сам клиент Axios (для доступа к defaults.baseURL), и объект с методами
export { apiClient };
export default apiMethods;
