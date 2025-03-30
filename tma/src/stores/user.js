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
        premium: { 1: 2500, 3: 5000, 12: 10000 },
        basic:   { 1: 1000, 3: 1500, 12: 5000 },
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
  }, // <--- Убедитесь, что здесь есть запятая перед actions

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true;
      this.errorProfile = null;
      try {
        const response = await api.getUserProfile();
        this.profile = response.data;
        console.log("User profile loaded:", this.profile);
      } catch (err) {
        console.error("Failed to fetch user profile:", err);
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
         console.log("Analysis history loaded, count:", this.history.length);
      } catch (err) {
        console.error("Failed to fetch analyses history:", err);
        this.errorHistory = err.response?.data?.error || err.message || 'Failed to load history';
      } finally {
        this.isLoadingHistory = false;
      }
    }, // <--- Запятая

    openSubscriptionModal() {
        this.showSubscriptionModal = true;
        this.selectedPlan = 'premium';
        this.selectedDuration = 3;
    }, // <--- Запятая

    closeSubscriptionModal() {
        this.showSubscriptionModal = false;
    }, // <--- Запятая

    selectPlan(plan) {
        this.selectedPlan = plan;
        this.selectedDuration = 3;
    }, // <--- Запятая

    selectDuration(duration) {
        this.selectedDuration = duration;
    }, // <--- Запятая! Вот вероятное место ошибки, если ее пропустили перед initiatePayment

    async initiatePayment() {
        const amount = this.selectedInvoiceAmount; // Используем геттер через this
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

        if (!amount || !tgUserId) {
            console.error("Cannot initiate payment: missing amount or user ID.");
            alert("Ошибка при подготовке платежа. Попробуйте снова.");
            return;
        }

        const payload = `sub_${this.selectedPlan}_${this.selectedDuration}mo_${tgUserId}`;
        console.log(`Preparing payment: amount=${amount}, payload=${payload}`);

        const tg = window.Telegram?.WebApp;
        if (tg?.MainButton) {
             tg.MainButton.showProgress(false);
             tg.MainButton.disable();
        }

        try {
            const response = await api.createInvoiceLink(
                this.selectedPlan,
                this.selectedDuration,
                amount,
                payload
            );

            const invoiceUrl = response.data?.invoiceUrl;
            if (!invoiceUrl) {
                throw new Error("Backend did not return an invoice URL.");
            }

             console.log("Received invoice URL:", invoiceUrl);

            if (tg?.openInvoice) {
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("Invoice status:", status);
                    if (status === 'paid') {
                        alert("Оплата прошла успешно! Ваша подписка будет обновлена в ближайшее время.");
                        this.closeSubscriptionModal();
                        setTimeout(() => this.fetchProfile(), 3000);
                    } else if (status === 'failed' || status === 'cancelled') {
                        alert(`Платеж не удался (статус: ${status}). Пожалуйста, попробуйте еще раз.`);
                    } else {
                        alert(`Статус платежа: ${status}.`);
                    }
                    if (tg?.MainButton) {
                       tg.MainButton.hideProgress();
                       tg.MainButton.enable();
                    }
                });
            } else {
                throw new Error("Telegram WebApp openInvoice method not available.");
            }

        } catch (error) {
            console.error("Error during payment initiation:", error);
            alert(`Ошибка при создании платежа: ${error.response?.data?.error || error.message || 'Неизвестная ошибка'}`);
             if (tg?.MainButton) {
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
             }
        }
    } // <--- Нет запятой после последнего метода в actions
  } // <--- Конец actions
}); // <--- Конец defineStore (строка ~228)
