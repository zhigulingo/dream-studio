// tma/src/stores/user.js
import { defineStore } from 'pinia';
import api from '@/services/api'; // Убедитесь, что путь верный

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
        premium: { 1: 1, 3: 1, 12: 1 }, // Цены в Stars!
        basic:   { 1: 1, 3: 1, 12: 1 }, // Цены в Stars!
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
    selectedInvoiceAmount(state) { // Преобразовали в метод
      const details = this.getPlanDetails(state.selectedPlan, state.selectedDuration);
      return details.price;
    }
  }, // <--- Запятая перед actions

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true;
      this.errorProfile = null;
      try {
        const response = await api.getUserProfile();
        this.profile = response.data;
        console.log("[UserStore] User profile loaded:", this.profile);
      } catch (err) {
        console.error("[UserStore] Failed to fetch user profile:", err);
        this.errorProfile = err.response?.data?.error || err.message || 'Failed to load profile';
      } finally {
        this.isLoadingProfile = false;
      }
    }, // <--- Запятая

    async fetchHistory() {
      this.isLoadingHistory = true;
      this.errorHistory = null;
      try {
        const response = await api.getAnalysesHistory();
        this.history = response.data;
         console.log("[UserStore] Analysis history loaded, count:", this.history.length);
      } catch (err) {
        console.error("[UserStore] Failed to fetch analyses history:", err);
        this.errorHistory = err.response?.data?.error || err.message || 'Failed to load history';
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

    // tma/src/stores/user.js -> actions: { ... }

    async initiatePayment() {
        const amount = this.selectedInvoiceAmount; // Теперь всегда 1 или null
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        const plan = this.selectedPlan;
        const duration = this.selectedDuration;

        if (!amount || !tgUserId || !plan || !duration) { // Проверяем все
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
            console.log("[UserStore] Requesting invoice link from backend...");
            // Логируем URL, на который пойдет запрос POST
            const targetUrl = `${import.meta.env.VITE_API_BASE_URL}/create-invoice`;
            console.log(`[UserStore] Target POST URL: ${targetUrl}`);

            const response = await api.createInvoiceLink(
                plan,
                duration,
                amount,
                payload
            );

            // Если дошли сюда, запрос прошел успешно (статус 2xx)
            const invoiceUrl = response.data?.invoiceUrl;
            if (!invoiceUrl) {
                console.error("[UserStore] Backend error: Did not return an invoice URL. Response:", response.data);
                throw new Error("Не удалось получить ссылку для оплаты от сервера (пустой ответ).");
            }

             console.log("[UserStore] Received invoice URL:", invoiceUrl);

            if (tg?.openInvoice) {
                tg.openInvoice(invoiceUrl, (status) => {
                    // ... обработка статуса платежа ...
                    console.log("[UserStore] Invoice status received:", status);
                    if (tg?.MainButton) {
                       tg.MainButton.hideProgress();
                       tg.MainButton.enable();
                    }
                    if (status === 'paid') { /* ... */ } else if (status === 'failed') { /* ... */ } // и т.д.
                     if (status === 'paid') { alert("Оплата прошла успешно! Ваша подписка будет обновлена в ближайшее время."); this.closeSubscriptionModal(); setTimeout(() => this.fetchProfile(), 3500); } else if (status === 'failed') { alert(`Платеж не удался (статус: ${status}). Пожалуйста, проверьте баланс Stars или попробуйте еще раз.`); } else if (status === 'cancelled') { alert("Платеж отменен."); } else { alert(`Статус платежа: ${status}. Возможно, потребуется некоторое время для завершения.`); }
                });
            } else {
                throw new Error("Telegram WebApp openInvoice method not available.");
            }

        } catch (error) {
            console.error("[UserStore] Axios/Network Error during payment initiation:", error); // Общий лог ошибки

            let alertMessage = 'Ошибка при создании платежа.';
            if (error.response) {
                // Ошибка пришла с ответом от сервера (статус не 2xx)
                console.error('[UserStore] Backend Error Response:', error.response.data);
                console.error('[UserStore] Backend Error Status:', error.response.status);
                console.error('[UserStore] Backend Error Headers:', error.response.headers);
                alertMessage = `Ошибка сервера (${error.response.status}): ${error.response.data?.error || 'Неизвестная ошибка'}`;
            } else if (error.request) {
                // Запрос был сделан, но ответ не получен (Network Error)
                console.error('[UserStore] Network Error: No response received. Request:', error.request);
                alertMessage = 'Сетевая ошибка: Не удалось связаться с сервером платежей. Проверьте интернет-соединение.';
            } else {
                // Ошибка настройки запроса или другая ошибка JS
                console.error('[UserStore] Request Setup Error:', error.message);
                alertMessage = `Ошибка настройки запроса: ${error.message}`;
            }
            alert(alertMessage); // Показываем ошибку пользователю

            if (tg?.MainButton) {
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
            }
        }
    } // Конец initiatePayment
  } // <--- Конец actions
});
