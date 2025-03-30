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
        premium: { 1: 2500, 3: 5000, 12: 10000 }, // Цены в Stars!
        basic:   { 1: 1000, 3: 1500, 12: 5000 }, // Цены в Stars!
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
        this.showSubscriptionModal = true; // Устанавливаем флаг
        this.selectedPlan = 'premium'; // Сбрасываем на дефолт
        this.selectedDuration = 3;     // Сбрасываем на дефолт
        console.log("[UserStore] Opening subscription modal, showSubscriptionModal:", this.showSubscriptionModal); // Лог для отладки
    }, // <--- Запятая

    closeSubscriptionModal() {
        this.showSubscriptionModal = false;
        console.log("[UserStore] Closing subscription modal, showSubscriptionModal:", this.showSubscriptionModal); // Лог
    }, // <--- Запятая

    selectPlan(plan) {
        this.selectedPlan = plan;
        this.selectedDuration = 3; // Сбрасываем длительность при смене плана
        console.log(`[UserStore] Plan selected: ${plan}`); // Лог
    }, // <--- Запятая

    selectDuration(duration) {
        this.selectedDuration = duration;
        console.log(`[UserStore] Duration selected: ${duration}`); // Лог
    }, // <--- Запятая

    async initiatePayment() {
        const amount = this.selectedInvoiceAmount; // Используем геттер
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

        if (!amount || !tgUserId) {
            console.error("Cannot initiate payment: missing amount or user ID.");
            alert("Ошибка при подготовке платежа. Попробуйте снова.");
            return;
        }

        const payload = `sub_${this.selectedPlan}_${this.selectedDuration}mo_${tgUserId}`;
        console.log(`[UserStore] Preparing payment: amount=${amount}, payload=${payload}`);

        const tg = window.Telegram?.WebApp;
        if (tg?.MainButton) {
             tg.MainButton.showProgress(false); // Показать бесконечный индикатор
             tg.MainButton.disable(); // Отключить кнопку на время запроса
        }

        try {
            // 1. Запрашиваем ссылку на инвойс с бэкенда
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

             console.log("[UserStore] Received invoice URL:", invoiceUrl);

            // 2. Открываем окно оплаты Telegram
            if (tg?.openInvoice) {
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("[UserStore] Invoice status:", status);
                    if (status === 'paid') {
                        alert("Оплата прошла успешно! Ваша подписка будет обновлена в ближайшее время.");
                        this.closeSubscriptionModal(); // Закрываем модалку
                        // Обновляем профиль через пару секунд
                        setTimeout(() => this.fetchProfile(), 3000);
                    } else if (status === 'failed' || status === 'cancelled') {
                        alert(`Платеж не удался (статус: ${status}). Пожалуйста, попробуйте еще раз.`);
                    } else { // pending или другие статусы
                        alert(`Статус платежа: ${status}.`);
                    }
                    // Скрываем индикатор и включаем кнопку после закрытия окна оплаты
                    if (tg?.MainButton) {
                       tg.MainButton.hideProgress();
                       tg.MainButton.enable();
                       // Можно снова настроить кнопку на случай, если модалка еще открыта
                       // watchEffect в модалке должен сам это сделать, но для надежности:
                       // if (this.showSubscriptionModal) {
                       //    const currentAmount = this.selectedInvoiceAmount;
                       //    if (currentAmount) {
                       //       tg.MainButton.setParams({ text: `Оплатить ${currentAmount} ⭐`, is_active: true });
                       //    }
                       // }
                    }
                });
            } else {
                throw new Error("Telegram WebApp openInvoice method not available.");
            }

        } catch (error) {
            console.error("[UserStore] Error during payment initiation:", error);
            alert(`Ошибка при создании платежа: ${error.response?.data?.error || error.message || 'Неизвестная ошибка'}`);
            // Скрываем индикатор и включаем кнопку при ошибке
             if (tg?.MainButton) {
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
                 // Можно настроить текст кнопки на "Попробовать снова" или скрыть ее
                 // if (this.showSubscriptionModal) {
                 //    tg.MainButton.setParams({ text: 'Ошибка. Попробовать снова?', is_active: true });
                 // }
             }
        }
    } // <--- Нет запятой после последнего метода
  } // <--- Конец actions
});
