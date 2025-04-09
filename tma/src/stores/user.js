// tma/src/stores/user.js (Исправлено: цены = 1)

import { defineStore } from 'pinia';
// Импортируем и дефолтный экспорт (методы), и именованный (клиент)
import api, { apiClient } from '@/services/api';

export const useUserStore = defineStore('user', {
  state: () => ({
    // --- Состояние для получения награды ---
    isClaimingReward: false,
    claimRewardError: null,
    claimRewardSuccessMessage: null,
    rewardAlreadyClaimed: false,
    userCheckedSubscription: false,
    // --- Основное состояние ---
    profile: { tokens: null, subscription_type: 'free', subscription_end: null, channel_reward_claimed: false },
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
    // --- Геттеры для UI награды ---
    canAttemptClaim: (state) => !state.profile?.channel_reward_claimed && !state.isClaimingReward,
    showClaimRewardSection: (state) => !state.isLoadingProfile && state.profile && !state.profile.channel_reward_claimed,
    // --- Основные геттеры ---
    isPremium: (state) => state.profile.subscription_type === 'premium',
    // <<<--- НАЧАЛО ИСПРАВЛЕНИЯ ЦЕН ---
    getPlanDetails: (state) => (plan, duration) => {
      // ВАШИ ЦЕНЫ ДЛЯ ТЕСТОВ = 1 ЗВЕЗДА
      const prices = { premium: { 1: 1, 3: 1, 12: 1 }, basic: { 1: 1, 3: 1, 12: 1 } };
      const features = {
            premium: ["Безлимитные токены", "Ранний доступ к фичам", "Без рекламы"],
            basic: ["30 токенов в месяц", "Стандартный анализ", "Поддержка"],
            free: ["1 пробный токен"]
        };
      const durationTextMap = { 1: '1 месяц', 3: '3 месяца', 12: '1 год' };
      return {
            price: prices[plan]?.[duration] ?? null, // Используем ваши цены = 1
            features: features[plan] ?? [],
            durationText: durationTextMap[duration] ?? `${duration} месяцев`
        };
    },
    selectedInvoiceAmount(state) {
      const details = this.getPlanDetails(state.selectedPlan, state.selectedDuration);
      const price = details.price;
      if (price === null) return null;
      // Для звезд нужно ЦЕЛОЕ число >= 1. Так как у вас 1, все ок.
      return Math.max(1, Math.round(price));
    }
    // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ЦЕН ---
  },

  actions: {
    async fetchProfile() {
      this.isLoadingProfile = true; this.errorProfile = null;
      this.claimRewardError = null; this.claimRewardSuccessMessage = null; this.userCheckedSubscription = false;
      try {
        console.log(`[UserStore:fetchProfile] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
        const response = await api.getUserProfile();
        this.profile = { ...this.profile, ...response.data };
        this.rewardAlreadyClaimed = this.profile?.channel_reward_claimed ?? false;
        console.log("[UserStore] Profile loaded:", this.profile);
      } catch (err) {
        console.error("[UserStore:fetchProfile] Error:", err);
        this.errorProfile = err.response?.data?.error || err.message || 'Network Error';
      } finally { this.isLoadingProfile = false; }
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
      } finally { this.isLoadingHistory = false; }
    },

    openSubscriptionModal() { this.showSubscriptionModal = true; this.selectedPlan = 'premium'; this.selectedDuration = 3; console.log("[UserStore] Opening modal"); },
    closeSubscriptionModal() { this.showSubscriptionModal = false; console.log("[UserStore] Closing modal"); },
    selectPlan(plan) { this.selectedPlan = plan; this.selectedDuration = 3; console.log(`[UserStore] Plan selected: ${plan}`); },
    selectDuration(duration) { this.selectedDuration = duration; console.log(`[UserStore] Duration selected: ${duration}`); },

    async initiatePayment() {
        console.log("[UserStore:initiatePayment] Action started.");
        const tg = window.Telegram?.WebApp;
        let amount = null, tgUserId = null, plan = null, duration = null, payload = null, initDataHeader = null;
        try {
            amount = this.selectedInvoiceAmount;
            tgUserId = tg?.initDataUnsafe?.user?.id;
            plan = this.selectedPlan;
            duration = this.selectedDuration;
            initDataHeader = tg?.initData;
            console.log("[UserStore:initiatePayment] Values:", { amount, tgUserId, plan, duration, initDataAvailable: !!initDataHeader });
            if (amount === null || amount < 1 || !tgUserId || !plan || !duration) { throw new Error("Отсутствуют или некорректны данные для инициирования платежа (сумма >= 1 XTR)."); }
            if (!initDataHeader) { throw new Error("Telegram InitData не найден. Перезапустите приложение."); }
            payload = `sub_${plan}_${duration}mo_${tgUserId}`;
            console.log(`[UserStore:initiatePayment] Payload created: ${payload}`);
            if (tg?.MainButton) { tg.MainButton.showProgress(false); tg.MainButton.disable(); }
            console.log("[UserStore:initiatePayment] Preparing fetch request...");
            const baseUrl = import.meta.env.VITE_API_BASE_URL;
            if (!baseUrl) { throw new Error("Конфигурация API не загружена (VITE_API_BASE_URL)."); }
            const targetUrl = `${baseUrl}/create-invoice`;
            const requestOptions = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initDataHeader }, body: JSON.stringify({ plan, duration, amount, payload }) };
            console.log("[UserStore:initiatePayment] Sending fetch request...");
            const response = await fetch(targetUrl, requestOptions);
            console.log("[UserStore:initiatePayment] Fetch response:", response.status, response.ok);
            if (!response.ok) { let errorText = `HTTP error ${response.status}`; try { const errorData = await response.json(); errorText = errorData.error || JSON.stringify(errorData); } catch (e) { try { errorText = await response.text(); } catch (e2) {} } console.error("[UserStore:initiatePayment] Backend error:", errorText); throw new Error(`Ошибка сервера: ${errorText}`); }
            const responseData = await response.json(); const invoiceUrl = responseData?.invoiceUrl;
            if (!invoiceUrl) { console.error("[UserStore:initiatePayment] Backend missing invoiceUrl:", responseData); throw new Error("Не удалось получить ссылку для оплаты."); }
            console.log("[UserStore:initiatePayment] Received invoice URL:", invoiceUrl);
            if (tg?.openInvoice) {
                console.log("[UserStore:initiatePayment] Calling tg.openInvoice...");
                tg.openInvoice(invoiceUrl, (status) => {
                    console.log("[UserStore:initiatePayment] Invoice callback status:", status);
                    if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); }
                    if (status === 'paid') { alert("Оплата прошла успешно! Профиль будет обновлен."); this.closeSubscriptionModal(); setTimeout(() => this.fetchProfile(), 4000); }
                    else if (status === 'failed') { alert(`Платеж не удался: ${status}`); }
                    else if (status === 'cancelled') { alert("Платеж отменен."); }
                    else { alert(`Статус платежа: ${status}.`); } });
            } else { throw new Error("Метод Telegram openInvoice недоступен."); }
        } catch (error) {
            console.error("[UserStore:initiatePayment] Error caught:", error);
            let alertMessage = `Ошибка: ${error.message || 'Неизвестная ошибка'}`;
            if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) { alertMessage = 'Сетевая ошибка. Проверьте интернет.'; }
            alert(alertMessage);
            if (tg?.MainButton) { tg.MainButton.hideProgress(); tg.MainButton.enable(); }
        }
    },

    async claimChannelReward() {
        console.log("[UserStore:claimChannelReward] Action started.");
        this.isClaimingReward = true; this.claimRewardError = null; this.claimRewardSuccessMessage = null; this.userCheckedSubscription = true;
        const tg = window.Telegram?.WebApp; const initDataHeader = tg?.initData;
        if (!initDataHeader) { this.claimRewardError = "Telegram InitData не найден."; this.isClaimingReward = false; console.error("[UserStore:claimChannelReward] Missing InitData."); return; }
        try {
            console.log(`[UserStore:claimChannelReward] Requesting from Base URL: ${apiClient.defaults.baseURL}`);
            const response = await api.claimChannelReward(); // Axios добавит заголовок
            console.log("[UserStore:claimChannelReward] Response received:", response.data);
            const data = response.data;
            if (data.success) {
                this.claimRewardSuccessMessage = data.message || "Токен успешно начислен!";
                this.rewardAlreadyClaimed = true; this.profile.channel_reward_claimed = true;
                if (typeof data.newTokens === 'number') { this.profile.tokens = data.newTokens; }
                else { console.warn("[UserStore:claimChannelReward] newTokens not returned, fetching profile."); await this.fetchProfile(); }
            } else {
                if (data.alreadyClaimed) { this.claimRewardError = data.message || "Награда уже была получена."; this.rewardAlreadyClaimed = true; this.profile.channel_reward_claimed = true; }
                else if (data.subscribed === false) { this.claimRewardError = data.message || "Необходимо подписаться на канал."; }
                else { this.claimRewardError = data.error || data.message || "Не удалось получить награду."; console.warn("[UserStore:claimChannelReward] Unspecified backend error:", data); }
            }
        } catch (err) {
            console.error("[UserStore:claimChannelReward] API Error:", err);
             let errorMsg = 'Ошибка сети/сервера.'; if (err.response?.data?.error) { errorMsg = err.response.data.error; } else if (err.message) { errorMsg = err.message; }
             this.claimRewardError = errorMsg;
        } finally { this.isClaimingReward = false; console.log("[UserStore:claimChannelReward] Action finished."); }
    }
  } // Конец actions
}); // Конец defineStore
