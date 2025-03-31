// tma/src/stores/user.js
import { defineStore } from 'pinia';
import api from '@/services/api'; // Мы все еще используем 'api' для GET запросов

export const useUserStore = defineStore('user', {
  state: () => ({
    profile: {
      tokens: null,
      subscription_type: 'free',
      subscription_end: null,
    },
    history: [],
    isLoadingProfile: false,
    isLoadingHistory: false,
    errorProfile: null,
    errorHistory: null,
    showSubscriptionModal: false,
    selectedPlan: 'premium',
    selectedDuration: 3,
  }),

  getters: {
    isPremium: (state) => state.profile.subscription_type === 'premium',
    getPlanDetails: (state) => (plan, duration) => {
      const prices = {
        // ЦЕНЫ УСТАНОВЛЕНЫ В 1 ДЛЯ ТЕСТИРОВАНИЯ
        premium: { 1: 1, 3: 1, 12: 1 },
        basic:   { 1: 1, 3: 1, 12: 1 },
      };
      const features = {
        premium: ["Безлимитные токены", "Ранний доступ к фичам", "Без рекламы"],
        basic:   ["30 токенов в месяц", "Стандартный анализ", "Поддержка"],
        free:    ["1 пробный токен"]
      };
      return {
        price: prices[plan]?.[duration] ?? null,
        features: features[plan] ?? [],
        durationText: `${duration} Month${duration > 1 ? 's' : ''}`
      };
    },
    selectedInvoiceAmount(state) {
      const details = this.getPlanDetails(state.selectedPlan, state.selectedDuration);
      return details.price;
    }
  }, // <--- Запятая перед actions

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true;
      this.errorProfile = null;
      try {
        // Используем Axios для GET, так как он работал
        const response = await api.getUserProfile();
        this.profile = response.data;
        console.log("[UserStore] User profile loaded:", this.profile);
      } catch (err) {
        console.error("[UserStore] Failed to fetch user profile:", err.response || err.request || err.message);
        this.errorProfile = err.response?.data?.error || err.message || 'Network Error'; // Установим Network Error по умолчанию
      } finally {
        this.isLoadingProfile = false;
      }
    }, // <--- Запятая

    async fetchHistory() {
      this.isLoadingHistory = true;
      this.errorHistory = null;
      try {
         // Используем Axios для GET
        const response = await api.getAnalysesHistory();
        this.history = response.data;
         console.log("[UserStore] Analysis history loaded, count:", this.history.length);
      } catch (err) {
        console.error("[UserStore] Failed to fetch analyses history:", err.response || err.request || err.message);
        this.errorHistory = err.response?.data?.error || err.message || 'Network Error'; // Установим Network Error по умолчанию
      } finally {
        this.isLoadingHistory = false;
      }
    }, // <--- Запятая

    openSubscriptionModal() {
        this.showSubscriptionModal = true;
        this.selectedPlan = 'premium';
        this.selectedDuration = 3;
        console.log("[UserStore] Opening subscription modal, showSubscriptionModal:", this.showSubscriptionModal);
    }, // <--- Запятая

    closeSubscriptionModal() {
        this.showSubscriptionModal = false;
        console.log("[UserStore] Closing subscription modal, showSubscriptionModal:", this.showSubscriptionModal);
    }, // <--- Запятая

    selectPlan(plan) {
        this.selectedPlan = plan;
        this.selectedDuration = 3;
        console.log(`[UserStore] Plan selected: ${plan}`);
    }, // <--- Запятая

    selectDuration(duration) {
        this.selectedDuration = duration;
        console.log(`[UserStore] Duration selected: ${duration}`);
    }, // <--- Запятая

    // Используем FETCH для initiatePayment
    async initiatePayment() {
        const amount = this.selectedInvoiceAmount;
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        const plan = this.selectedPlan;
        const duration = this.selectedDuration;

        if (!amount || !tgUserId || !plan || !duration) {
            console.error("[UserStore] Cannot initiate payment: missing data.", { amount, tgUserId, plan, duration });
            alert("Ошибка: Не все данные для платежа выбраны.");
            return;
        }

        const payload = `sub_${plan}_${duration}mo_${tgUserId}`;
        console.log(`[UserStore] Preparing payment: amount=${amount}, payload=${payload}, plan=${plan}, duration=${duration}`);

        const tg = window.Telegram?.WebApp;
        if (tg?.MainButton) {
             tg.MainButton.showProgress(false);
             tg.MainButton.disable();
        }

        try {
            console.log("[UserStore] Requesting invoice link from backend using fetch...");
            // URL для POST запроса
            const baseUrl = import.meta.env.VITE_API_BASE_URL; // Считываем из переменных окружения
             if (!baseUrl) {
                throw new Error("Конфигурация API не загружена (VITE_API_BASE_URL).");
            }
            const targetUrl = `${baseUrl}/create-invoice`;
            console.log(`[UserStore] Target POST URL (fetch): ${targetUrl}`);

            // Проверяем наличие initData
            const initDataHeader = window.Telegram?.WebApp?.initData;
            if (!initDataHeader) {
                throw new Error("Telegram InitData не найден. Невозможно авторизовать запрос.");
            }

            // Опции для fetch
            const requestOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Telegram-Init-Data': initDataHeader
                },
                body: JSON.stringify({
                    plan: plan,
                    duration: duration,
                    amount: amount,
                    payload: payload
                })
            };

            console.log("[UserStore] Fetch request options (excluding headers):", { method: requestOptions.method, body: requestOptions.body });

            const response = await fetch(targetUrl, requestOptions);

            console.log("[UserStore] Fetch response status:", response.status);
            console.log("[UserStore] Fetch response ok:", response.ok);

            if (!response.ok) {
                let errorText = `HTTP error! Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorText = errorData.error || JSON.stringify(errorData);
                } catch (e) {
                    try { errorText = await response.text(); } catch (e2) { /* Используем HTTP статус */ }
                }
                 console.error("[UserStore] Backend error response text/data:", errorText);
                throw new Error(errorText);
            }

            // Ответ ОК (2xx)
            const responseData = await response.json();
            const invoiceUrl = responseData?.invoiceUrl;

            if (!invoiceUrl) {
                console.error("[UserStore] Backend error: Did not return an invoice URL in JSON. Response:", responseData);
                throw new Error("Не удалось получить ссылку для оплаты от сервера (неверный формат ответа).");
            }

            console.log("[UserStore] Received invoice URL via fetch:", invoiceUrl);

            // Открываем окно оплаты
            if (tg?.openInvoice) {
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("[UserStore] Invoice status received:", status);
                    if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); }

                    if (status === 'paid') {
                        alert("Оплата прошла успешно! Ваша подписка будет обновлена в ближайшее время.");
                        this.closeSubscriptionModal();
                        setTimeout(() => this.fetchProfile(), 3500);
                    } else if (status === 'failed') {
                        alert(`Платеж не удался (статус: ${status}). Пожалуйста, проверьте баланс Stars или попробуйте еще раз.`);
                    } else if (status === 'cancelled') {
                        alert("Платеж отменен.");
                    } else {
                        alert(`Статус платежа: ${status}. Возможно, потребуется некоторое время для завершения.`);
                    }
                });
            } else {
                throw new Error("Telegram WebApp openInvoice method not available.");
            }

        } catch (error) {
            console.error("[UserStore] Error during fetch/payment initiation process:", error);
            // Определяем тип ошибки для сообщения пользователю
            let alertMessage = `Ошибка при создании платежа: ${error.message || 'Неизвестная ошибка'}`;
            // Проверяем, является ли это ошибкой сети (fetch падает с TypeError для network errors)
            if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
                 alertMessage = 'Сетевая ошибка: Не удалось связаться с сервером платежей. Проверьте интернет-соединение.';
            }
            alert(alertMessage);

            if (tg?.MainButton) { // Включаем кнопку при любой ошибке
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
            }
        }
    } // <--- Конец initiatePayment
  } // <--- Конец actions
}); // <--- Конец defineStore
