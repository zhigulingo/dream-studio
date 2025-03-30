// tma/src/stores/user.js
import { defineStore } from 'pinia';
import api from '@/services/api'; // Путь к вашему api.js

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
    // Состояние для модального окна подписки
    showSubscriptionModal: false,
    selectedPlan: 'premium', // 'basic' or 'premium'
    selectedDuration: 3, // 1, 3, 12
  }),

  getters: {
    isPremium: (state) => state.profile.subscription_type === 'premium', // Пример геттера
    // Геттер для получения деталей плана (цены нужно будет определить)
    getPlanDetails: (state) => (plan, duration) => {
        // Здесь должна быть логика определения цены в Stars и списка фич
        // Пример (цены нужно будет задать!)
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
     // Выбранная цена для кнопки оплаты
    selectedInvoiceAmount: (state) => {
        const details = state.getPlanDetails(state.selectedPlan, state.selectedDuration);
        return details.price;
    }
  },

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
        this.errorProfile = err.response?.data?.message || err.message || 'Failed to load profile';
      } finally {
        this.isLoadingProfile = false;
      }
    },

    async fetchHistory() {
      this.isLoadingHistory = true;
      this.errorHistory = null;
      try {
        const response = await api.getAnalysesHistory();
        this.history = response.data;
         console.log("Analysis history loaded, count:", this.history.length);
      } catch (err) {
        console.error("Failed to fetch analyses history:", err);
        this.errorHistory = err.response?.data?.message || err.message || 'Failed to load history';
      } finally {
        this.isLoadingHistory = false;
      }
    },

    openSubscriptionModal() {
        this.showSubscriptionModal = true;
        // Можно сбросить выбор по умолчанию при открытии
        this.selectedPlan = 'premium';
        this.selectedDuration = 3;
    },

    closeSubscriptionModal() {
        this.showSubscriptionModal = false;
    },

    selectPlan(plan) {
        this.selectedPlan = plan;
        // Возможно, сбросить длительность при смене плана
        this.selectedDuration = 3;
    },

    selectDuration(duration) {
        this.selectedDuration = duration;
    },

    // Действие для инициации платежа
    async initiatePayment() { // <<<--- Делаем async
        const amount = this.selectedInvoiceAmount;
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

        if (!amount || !tgUserId) {
            console.error("Cannot initiate payment: missing amount or user ID.");
            alert("Ошибка при подготовке платежа. Попробуйте снова.");
            return;
        }

        const payload = `sub_${this.selectedPlan}_${this.selectedDuration}mo_${tgUserId}`;
        console.log(`Preparing payment: amount=${amount}, payload=${payload}`);

        // Показываем индикатор загрузки на кнопке
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

             console.log("Received invoice URL:", invoiceUrl);

            // 2. Открываем окно оплаты Telegram
            if (tg?.openInvoice) {
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("Invoice status:", status);
                    if (status === 'paid') {
                        alert("Оплата прошла успешно! Ваша подписка будет обновлена в ближайшее время.");
                        this.closeSubscriptionModal(); // Закрываем модалку
                        // Можно обновить профиль через пару секунд
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
                    }
                });
            } else {
                throw new Error("Telegram WebApp openInvoice method not available.");
            }

        } catch (error) {
            console.error("Error during payment initiation:", error);
            alert(`Ошибка при создании платежа: ${error.response?.data?.error || error.message || 'Неизвестная ошибка'}`);
            // Скрываем индикатор и включаем кнопку при ошибке
             if (tg?.MainButton) {
                 tg.MainButton.hideProgress();
                 tg.MainButton.enable();
             }
        }
    }

        // Создаем payload: строка, которую бот получит после успешной оплаты
        // и сможет использовать для обновления подписки пользователя.
        // Включаем ID пользователя для надежности (валидация initData уже прошла).
        const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id; // Получаем ID (после валидации на бэке он достоверен)
        if (!tgUserId) {
             console.error("Cannot initiate payment: Telegram User ID not found in initData");
             alert("Error identifying user. Please try again.");
             return;
        }
        const payload = `sub_${this.selectedPlan}_${this.selectedDuration}mo_${tgUserId}`;

        console.log(`Initiating Telegram Stars payment: amount=${amount}, payload=${payload}`);

        try {
            if (window.Telegram?.WebApp?.openInvoice) {
                // Telegram Stars использует метод openInvoice
                // Первый аргумент - SLUG инвойса (если настроено через BotFather/платформу)
                // Но для динамической цены часто используется ссылка, генерируемая ботом.
                // **** Вариант 1: Генерация ссылки ботом (предпочтительный) ****
                alert("Payment logic needs backend integration (createInvoiceLink)."); // Заглушка
                // 1. Отправить запрос на ваш бэкенд (новая Netlify Function): POST /api/create-invoice
                //    с параметрами: plan, duration, amount, payload
                // 2. Бэкенд вызывает метод Telegram Bot API `createInvoiceLink`
                // 3. Бэкенд возвращает ссылку `invoiceUrl`
                // 4. Вызвать window.Telegram.WebApp.openInvoice(invoiceUrl, (status) => { ... });

                // **** Вариант 2 (Упрощенный, если есть *статичный* SLUG для каждой цены) ****
                // const invoiceSlug = `your_static_slug_${plan}_${duration}`; // Заменить на реальный SLUG
                // window.Telegram.WebApp.openInvoice(invoiceSlug, (status) => {
                //    console.log("Invoice status:", status); // paid, cancelled, failed, pending
                //    if (status === 'paid') {
                //        alert("Payment successful! Your subscription will be updated shortly.");
                //        this.closeSubscriptionModal();
                //        // Данные обновятся, когда бот обработает successful_payment
                //        // Можно запустить fetchProfile() через пару секунд для обновления UI
                //        setTimeout(() => this.fetchProfile(), 3000);
                //    } else {
                //        alert(`Payment ${status}. Please try again.`);
                //    }
                // });

            } else {
                console.error("Telegram WebApp openInvoice method not available.");
                 alert("Payment cannot be processed in this environment.");
            }
        } catch (error) {
            console.error("Error opening Telegram invoice:", error);
            alert("An error occurred while trying to initiate payment.");
        }
    }

  },
});
