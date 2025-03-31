// tma/src/stores/user.js
import { defineStore } from 'pinia';
// Импортируем и дефолтный экспорт (методы), и именованный (клиент)
import api, { apiClient } from '@/services/api';

export const useUserStore = defineStore('user', {
  state: () => ({
    profile: { tokens: null, subscription_type: 'free', subscription_end: null },
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
      const prices = { premium: { 1: 1, 3: 1, 12: 1 }, basic: { 1: 1, 3: 1, 12: 1 } }; // Test price = 1
      const features = { premium: ["Безлимитные токены", "Ранний доступ к фичам", "Без рекламы"], basic: ["30 токенов в месяц", "Стандартный анализ", "Поддержка"], free: ["1 пробный токен"] };
      return { price: prices[plan]?.[duration] ?? null, features: features[plan] ?? [], durationText: `${duration} Month${duration > 1 ? 's' : ''}` };
    },
    selectedInvoiceAmount(state) {
      const details = this.getPlanDetails(state.selectedPlan, state.selectedDuration);
      return details.price;
    }
  },

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true; this.errorProfile = null;
      try {
        // Логируем URL перед запросом
        console.log(`[UserStore:fetchProfile] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
        const response = await api.getUserProfile(); // Используем дефолтный экспорт с методами
        this.profile = response.data;
        console.log("[UserStore] Profile loaded:", this.profile);
      } catch (err) {
        // Ошибка уже логируется перехватчиком Axios в api.js
        this.errorProfile = err.response?.data?.error || err.message || 'Network Error';
      } finally {
        this.isLoadingProfile = false;
      }
    },

    async fetchHistory() {
      this.isLoadingHistory = true; this.errorHistory = null;
      try {
        // Логируем URL перед запросом
        console.log(`[UserStore:fetchHistory] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
        const response = await api.getAnalysesHistory(); // Используем дефолтный экспорт с методами
        this.history = response.data;
        console.log("[UserStore] History loaded, count:", this.history.length);
      } catch (err) {
         // Ошибка уже логируется перехватчиком Axios в api.js
        this.errorHistory = err.response?.data?.error || err.message || 'Network Error';
      } finally {
        this.isLoadingHistory = false;
      }
    },

    openSubscriptionModal() { this.showSubscriptionModal = true; this.selectedPlan = 'premium'; this.selectedDuration = 3; console.log("[UserStore] Opening modal"); },
    closeSubscriptionModal() { this.showSubscriptionModal = false; console.log("[UserStore] Closing modal"); },
    selectPlan(plan) { this.selectedPlan = plan; this.selectedDuration = 3; console.log(`[UserStore] Plan selected: ${plan}`); },
    selectDuration(duration) { this.selectedDuration = duration; console.log(`[UserStore] Duration selected: ${duration}`); },

    // initiatePayment остается таким же, как в предыдущем ответе (с использованием fetch)
    async initiatePayment() {
        console.log("[UserStore:initiatePayment] Action started.");
        const tg = window.Telegram?.WebApp;
        let amount = null, tgUserId = null, plan = null, duration = null, payload = null, initDataHeader = null;
        try {
            console.log("[UserStore:initiatePayment] Reading state and initData...");
            amount = this.selectedInvoiceAmount;
            tgUserId = tg?.initDataUnsafe?.user?.id;
            plan = this.selectedPlan;
            duration = this.selectedDuration;
            initDataHeader = tg?.initData;
            console.log("[UserStore:initiatePayment] Values:", { amount, tgUserId, plan, duration, initDataAvailable: !!initDataHeader });
            if (!amount || !tgUserId || !plan || !duration) { throw new Error("Отсутствуют необходимые данные для платежа."); }
            if (!initDataHeader) { throw new Error("Telegram InitData не найден."); }
            payload = `sub_${plan}_${duration}mo_${tgUserId}`;
            console.log(`[UserStore:initiatePayment] Payload created: ${payload}`);
            if (tg?.MainButton) { console.log("[UserStore:initiatePayment] Showing MainButton progress..."); tg.MainButton.showProgress(false); tg.MainButton.disable(); }
            else { console.warn("[UserStore:initiatePayment] MainButton API not available."); }
            console.log("[UserStore:initiatePayment] Preparing fetch request...");
            const baseUrl = import.meta.env.VITE_API_BASE_URL;
            if (!baseUrl) { throw new Error("Конфигурация API не загружена (VITE_API_BASE_URL)."); }
            const targetUrl = `${baseUrl}/create-invoice`;
            console.log(`[UserStore:initiatePayment] Target fetch URL: ${targetUrl}`);
            const requestOptions = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initDataHeader }, body: JSON.stringify({ plan, duration, amount, payload }) };
            console.log("[UserStore:initiatePayment] Sending fetch request...");
            const response = await fetch(targetUrl, requestOptions);
            console.log("[UserStore:initiatePayment] Fetch response received. Status:", response.status, "Ok:", response.ok);
            if (!response.ok) { let errorText = `HTTP error! Status: ${response.status}`; try { const errorData = await response.json(); errorText = errorData.error || JSON.stringify(errorData); } catch (e) { try { errorText = await response.text(); } catch (e2) {} } console.error("[UserStore:initiatePayment] Backend error response:", errorText); throw new Error(errorText); }
            const responseData = await response.json();
            const invoiceUrl = responseData?.invoiceUrl;
            if (!invoiceUrl) { console.error("[UserStore:initiatePayment] Backend response missing invoiceUrl:", responseData); throw new Error("Не удалось получить ссылку для оплаты от сервера."); }
            console.log("[UserStore:initiatePayment] Received invoice URL:", invoiceUrl);
            if (tg?.openInvoice) { console.log("[UserStore:initiatePayment] Calling tg.openInvoice..."); tg.openInvoice(invoiceUrl, (status) => { console.log("[UserStore:initiatePayment] Invoice status callback:", status); if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); } if (status === 'paid') { alert("Оплата прошла успешно!"); this.closeSubscriptionModal(); setTimeout(() => this.fetchProfile(), 3500); } else if (status === 'failed') { alert(`Платеж не удался: ${status}`); } else if (status === 'cancelled') { alert("Платеж отменен."); } else { alert(`Статус платежа: ${status}.`); } }); console.log("[UserStore:initiatePayment] tg.openInvoice called."); }
            else { throw new Error("Telegram WebApp openInvoice method not available."); }
        } catch (error) {
            console.error("[UserStore:initiatePayment] Error caught:", error);
            let alertMessage = `Ошибка: ${error.message || 'Неизвестная ошибка'}`;
            if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) { alertMessage = 'Сетевая ошибка: Не удалось связаться с сервером. Проверьте интернет-соединение.'; }
            alert(alertMessage);
            if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); console.log("[UserStore:initiatePayment] MainButton re-enabled after error."); }
        }
    } // Конец initiatePayment
  } // Конец actions
}); // Конец defineStore
