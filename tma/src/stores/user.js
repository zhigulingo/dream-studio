import { defineStore } from 'pinia';
// Импортируем и дефолтный экспорт (методы), и именованный (клиент)
import api, { apiClient } from '@/services/api'; // Убедитесь, что api.js экспортирует метод claimChannelReward

export const useUserStore = defineStore('user', {
  state: () => ({
    // --- ДОБАВЛЕНО: Состояние для получения награды ---
    isClaimingReward: false,
    claimRewardError: null,
    claimRewardSuccessMessage: null,
    rewardAlreadyClaimed: false, // Флаг, что уже получали (для UI)
    userCheckedSubscription: false, // Пытался ли пользователь проверить подписку
    // --- КОНЕЦ ДОБАВЛЕННОГО СОСТОЯНИЯ ---

    // Добавляем channel_reward_claimed в инициализацию профиля, если он может быть null
    profile: { tokens: null, subscription_type: 'free', subscription_end: null, channel_reward_claimed: false },
    history: [],
    isLoadingProfile: false,
    isLoadingHistory: false,
    errorProfile: null,
    errorHistory: null,
    showSubscriptionModal: false,
    selectedPlan: 'premium', // Убедитесь, что 'premium' - дефолтный выбор
    selectedDuration: 3,    // Убедитесь, что 3 - дефолтный выбор
  }),

  getters: {
    // --- ДОБАВЛЕНО: Геттер для UI ---
    // Можно ли пытаться получить награду (еще не получал И не в процессе получения)
    canAttemptClaim: (state) => !state.profile?.channel_reward_claimed && !state.isClaimingReward,
    // Нужно ли показывать секцию с наградой (профиль загружен И награда еще не получена)
    showClaimRewardSection: (state) => !state.isLoadingProfile && state.profile && !state.profile.channel_reward_claimed,
    // --- КОНЕЦ ДОБАВЛЕННЫХ ГЕТТЕРОВ ---

    isPremium: (state) => state.profile.subscription_type === 'premium',
    // Убедитесь, что цены и описания корректны
    getPlanDetails: (state) => (plan, duration) => {
        // Пример цен (замените реальными!)
        const prices = { premium: { 1: 500, 3: 1200, 12: 4000 }, basic: { 1: 200, 3: 500, 12: 1500 } };
        const features = {
            premium: ["Безлимитные токены", "Ранний доступ к фичам", "Без рекламы"],
            basic: ["30 токенов в месяц", "Стандартный анализ", "Поддержка"],
            free: ["1 пробный токен"]
        };
        const durationTextMap = { 1: '1 месяц', 3: '3 месяца', 12: '1 год' };
        return {
            price: prices[plan]?.[duration] ?? null,
            features: features[plan] ?? [],
            durationText: durationTextMap[duration] ?? `${duration} месяцев`
        };
    },
    selectedInvoiceAmount(state) {
      const details = this.getPlanDetails(state.selectedPlan, state.selectedDuration);
      // Важно: Сумма для Telegram Stars (XTR) должна быть ЦЕЛЫМ ЧИСЛОМ >= 1
      // Если ваши цены не целые, их нужно округлить или пересчитать в XTR
      const price = details.price;
      if (price === null) return null;
      // Убедимся, что возвращаем целое число, не меньше 1
      return Math.max(1, Math.round(price));
    }
  },

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true; this.errorProfile = null;
      // --- СБРОС СОСТОЯНИЯ НАГРАДЫ ПРИ ОБНОВЛЕНИИ ПРОФИЛЯ ---
      this.claimRewardError = null;
      this.claimRewardSuccessMessage = null;
      this.userCheckedSubscription = false; // Сбрасываем флаг попытки проверки
      // --- КОНЕЦ СБРОСА ---
      try {
        console.log(`[UserStore:fetchProfile] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
        const response = await api.getUserProfile();
        // Обновляем весь профиль или только необходимые поля, чтобы избежать затирания null'ами
        this.profile = { ...this.profile, ...response.data };
        // Обновляем локальный флаг на основе данных из профиля
        this.rewardAlreadyClaimed = this.profile?.channel_reward_claimed ?? false;
        console.log("[UserStore] Profile loaded:", this.profile);
      } catch (err) {
        console.error("[UserStore:fetchProfile] Error:", err);
        this.errorProfile = err.response?.data?.error || err.message || 'Network Error';
      } finally {
        this.isLoadingProfile = false;
      }
    },

    async fetchHistory() {
      this.isLoadingHistory = true; this.errorHistory = null;
      try {
        console.log(`[UserStore:fetchHistory] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
        const response = await api.getAnalysesHistory();
        this.history = response.data;
        console.log("[UserStore] History loaded, count:", this.history.length);
      } catch (err) {
        console.error("[UserStore:fetchHistory] Error:", err);
        this.errorHistory = err.response?.data?.error || err.message || 'Network Error';
      } finally {
        this.isLoadingHistory = false;
      }
    },

    openSubscriptionModal() { this.showSubscriptionModal = true; /* Устанавливаем дефолты при открытии */ this.selectedPlan = 'premium'; this.selectedDuration = 3; console.log("[UserStore] Opening modal"); },
    closeSubscriptionModal() { this.showSubscriptionModal = false; console.log("[UserStore] Closing modal"); },
    selectPlan(plan) { this.selectedPlan = plan; /* Можно сбрасывать длительность при смене плана */ this.selectedDuration = 3; console.log(`[UserStore] Plan selected: ${plan}`); },
    selectDuration(duration) { this.selectedDuration = duration; console.log(`[UserStore] Duration selected: ${duration}`); },

    async initiatePayment() {
        console.log("[UserStore:initiatePayment] Action started.");
        const tg = window.Telegram?.WebApp;
        let amount = null, tgUserId = null, plan = null, duration = null, payload = null, initDataHeader = null;
        try {
            console.log("[UserStore:initiatePayment] Reading state and initData...");
            amount = this.selectedInvoiceAmount; // Получаем сумму из геттера (уже в XTR >= 1)
            tgUserId = tg?.initDataUnsafe?.user?.id;
            plan = this.selectedPlan;
            duration = this.selectedDuration;
            initDataHeader = tg?.initData; // Полная строка initData для верификации на бэке

            console.log("[UserStore:initiatePayment] Values:", { amount, tgUserId, plan, duration, initDataAvailable: !!initDataHeader });

            // Проверка данных перед отправкой
            if (amount === null || amount < 1 || !tgUserId || !plan || !duration) {
                 throw new Error("Отсутствуют или некорректны данные для инициирования платежа (сумма должна быть >= 1 XTR).");
            }
            if (!initDataHeader) {
                throw new Error("Telegram InitData не найден. Пожалуйста, перезапустите приложение.");
            }

            // Формируем payload: sub_plan_duration_tgUserId
            payload = `sub_${plan}_${duration}mo_${tgUserId}`;
            console.log(`[UserStore:initiatePayment] Payload created: ${payload}`);

            // Показываем прогресс на главной кнопке Telegram
            if (tg?.MainButton) {
                console.log("[UserStore:initiatePayment] Showing MainButton progress...");
                tg.MainButton.showProgress(false); // Показываем бесконечный прогресс
                tg.MainButton.disable(); // Блокируем кнопку
            } else {
                console.warn("[UserStore:initiatePayment] MainButton API not available.");
            }

            console.log("[UserStore:initiatePayment] Preparing fetch request...");
            const baseUrl = import.meta.env.VITE_API_BASE_URL;
            if (!baseUrl) {
                throw new Error("Конфигурация API не загружена (VITE_API_BASE_URL).");
            }
            const targetUrl = `${baseUrl}/create-invoice`; // Эндпоинт бэкенд-функции
            console.log(`[UserStore:initiatePayment] Target fetch URL: ${targetUrl}`);

            // Опции для fetch запроса
            const requestOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Telegram-Init-Data': initDataHeader // Передаем initData для верификации
                },
                body: JSON.stringify({ plan, duration, amount, payload }) // Передаем данные в теле
            };

            console.log("[UserStore:initiatePayment] Sending fetch request...");
            const response = await fetch(targetUrl, requestOptions);
            console.log("[UserStore:initiatePayment] Fetch response received. Status:", response.status, "Ok:", response.ok);

            // Обработка ответа от бэкенда
            if (!response.ok) {
                let errorText = `HTTP error! Status: ${response.status}`;
                try {
                    // Пытаемся извлечь сообщение об ошибке из JSON ответа бэкенда
                    const errorData = await response.json();
                    errorText = errorData.error || JSON.stringify(errorData); // Используем поле 'error', если оно есть
                } catch (e) {
                    try { errorText = await response.text(); } catch (e2) {} // Если не JSON, пытаемся получить текст
                }
                console.error("[UserStore:initiatePayment] Backend error response:", errorText);
                throw new Error(`Ошибка от сервера: ${errorText}`); // Выбрасываем ошибку с текстом от бэкенда
            }

            // Если ответ успешный, извлекаем URL инвойса
            const responseData = await response.json();
            const invoiceUrl = responseData?.invoiceUrl; // Ожидаем поле 'invoiceUrl'

            if (!invoiceUrl) {
                console.error("[UserStore:initiatePayment] Backend response missing invoiceUrl:", responseData);
                throw new Error("Не удалось получить ссылку для оплаты от сервера.");
            }
            console.log("[UserStore:initiatePayment] Received invoice URL:", invoiceUrl);

            // Открываем окно оплаты Telegram
            if (tg?.openInvoice) {
                console.log("[UserStore:initiatePayment] Calling tg.openInvoice...");
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("[UserStore:initiatePayment] Invoice status callback:", status);
                    // Прячем прогресс и разблокируем кнопку в любом случае после закрытия окна
                    if (tg?.MainButton) {
                         tg.MainButton.hideProgress();
                         tg.MainButton.enable();
                    }
                    // Обработка статуса платежа
                    if (status === 'paid') {
                        alert("Оплата прошла успешно! Ваш профиль будет обновлен.");
                        this.closeSubscriptionModal(); // Закрываем модалку
                        // Обновляем профиль через некоторое время, чтобы дать бэкенду обработать вебхук
                        setTimeout(() => this.fetchProfile(), 4000); // Задержка 4 сек
                    } else if (status === 'failed') {
                        alert(`Платеж не удался. Статус: ${status}`);
                    } else if (status === 'cancelled') {
                        alert("Платеж отменен.");
                    } else {
                        // Другие возможные статусы (pending, etc.)
                        alert(`Статус платежа: ${status}.`);
                    }
                });
                console.log("[UserStore:initiatePayment] tg.openInvoice called.");
            } else {
                throw new Error("Метод Telegram WebApp openInvoice недоступен.");
            }
        } catch (error) {
            console.error("[UserStore:initiatePayment] Error caught:", error);
            let alertMessage = `Ошибка инициации платежа: ${error.message || 'Неизвестная ошибка'}`;
            // Улучшенное сообщение об ошибке сети
            if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
                alertMessage = 'Сетевая ошибка: Не удалось связаться с сервером для создания счета. Проверьте интернет-соединение или попробуйте позже.';
            }
            alert(alertMessage); // Показываем ошибку пользователю

            // Убеждаемся, что кнопка разблокирована при любой ошибке
            if (tg?.MainButton) {
                tg.MainButton.hideProgress();
                tg.MainButton.enable();
                console.log("[UserStore:initiatePayment] MainButton re-enabled after error.");
            }
        }
    }, // <<<--- ВОТ ОНА, ПРОПУЩЕННАЯ СКОБКА И ЗАПЯТАЯ!

    // <<<--- НОВОЕ ДЕЙСТВИЕ ---
    async claimChannelReward() {
        console.log("[UserStore:claimChannelReward] Action started.");
        this.isClaimingReward = true;
        this.claimRewardError = null;
        this.claimRewardSuccessMessage = null;
        this.userCheckedSubscription = true; // Пользователь нажал кнопку проверки

        // Добавляем проверку initData перед запросом
        const tg = window.Telegram?.WebApp;
        const initDataHeader = tg?.initData;
        if (!initDataHeader) {
             this.claimRewardError = "Telegram InitData не найден. Пожалуйста, перезапустите приложение.";
             this.isClaimingReward = false;
             console.error("[UserStore:claimChannelReward] Missing InitData.");
             return; // Прерываем выполнение
        }

        try {
            console.log(`[UserStore:claimChannelReward] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
            // Убедитесь, что api.js содержит метод claimChannelReward, который делает POST запрос
            // к вашей новой функции /claim-channel-token, передавая initData в заголовке.
            const response = await api.claimChannelReward(); // Axios сам добавит заголовок через интерцептор
            console.log("[UserStore:claimChannelReward] Response received:", response.data);

            const data = response.data; // Ожидаем объект от бэкенда
            if (data.success) {
                this.claimRewardSuccessMessage = data.message || "Токен успешно начислен!";
                this.rewardAlreadyClaimed = true; // Ставим флаг локально
                this.profile.channel_reward_claimed = true; // Обновляем флаг в профиле
                // Обновляем токены в профиле, если сервер их вернул
                if (typeof data.newTokens === 'number') {
                    this.profile.tokens = data.newTokens;
                } else {
                    // Если токены не вернулись, лучше перезапросить профиль для точности
                    console.warn("[UserStore:claimChannelReward] newTokens not returned, fetching profile again.");
                    await this.fetchProfile(); // Обновит и токены, и флаг claimed
                }
            } else {
                // Обрабатываем разные причины неудачи, ожидая поля от бэкенда
                if (data.alreadyClaimed) {
                    this.claimRewardError = data.message || "Награда уже была получена ранее.";
                    this.rewardAlreadyClaimed = true; // Устанавливаем флаг, если сервер подтвердил
                    this.profile.channel_reward_claimed = true; // Синхронизируем с состоянием
                } else if (data.subscribed === false) { // Ожидаем поле subscribed: false
                    this.claimRewardError = data.message || "Для получения награды необходимо подписаться на канал.";
                    // Не ставим rewardAlreadyClaimed = true, даем попробовать еще раз
                } else {
                    // Любая другая ошибка от бэкенда (например, ошибка базы данных)
                    this.claimRewardError = data.error || data.message || "Не удалось получить награду (неизвестная причина).";
                     console.warn("[UserStore:claimChannelReward] Unspecified error from backend:", data);
                }
            }

        } catch (err) {
            console.error("[UserStore:claimChannelReward] Error caught during API call:", err);
            // Обработка ошибок сети или ошибок, выброшенных Axios (уже залогированных в api.js)
             let errorMsg = 'Произошла ошибка сети или сервера при попытке получить награду.';
             if (err.response?.data?.error) {
                 errorMsg = err.response.data.error; // Используем сообщение об ошибке от бэкенда, если есть
             } else if (err.message) {
                 errorMsg = err.message; // Используем сообщение самой ошибки JS
             }
             this.claimRewardError = errorMsg;
        } finally {
            this.isClaimingReward = false;
            console.log("[UserStore:claimChannelReward] Action finished.");
        }
    }
  } // Конец actions
}); // Конец defineStore
