<template>
  <div class="personal-account">
    <!-- Показываем или основной ЛК, или страницу получения награды -->
    <template v-if="!showRewardClaimView">
      <h1>Личный кабинет</h1>

      <!-- Блок 1: Информация о пользователе -->
      <section class="user-info card">
        <h2>Ваш профиль</h2>
        <div v-if="userStore.isLoadingProfile">Загрузка профиля...</div>
        <div v-else-if="userStore.errorProfile" class="error-message">
          Ошибка загрузки профиля: {{ userStore.errorProfile }}
        </div>
        <div v-else-if="userStore.profile.tokens !== null">
          <p>Остаток токенов: <strong>{{ userStore.profile.tokens }}</strong></p>
          <p>
            Текущий тариф: <strong class="capitalize">{{ userStore.profile.subscription_type }}</strong>
            <span v-if="userStore.profile.subscription_end">
              (до {{ formatDate(userStore.profile.subscription_end) }})
            </span>
          </p>
          <button
              v-if="userStore.profile.subscription_type !== 'free' || userStore.profile.channel_reward_claimed"
              @click="userStore.openSubscriptionModal"
              class="change-plan-button">
            Сменить тариф <!-- Ваш текст -->
          </button>
           <button
                v-else-if="userStore.profile.subscription_type === 'free' && !userStore.profile.channel_reward_claimed"
                @click="showRewardClaimView = true"
                class="subscribe-button-main">
                🎁 Получить бесплатный токен за подписку
           </button>
        </div>
        <div v-else>
          <p>Не удалось загрузить данные профиля.</p>
        </div>
         <div v-if="!userStore.isLoadingProfile && userStore.profile?.channel_reward_claimed" class="reward-claimed-info">
             <p>✅ Награда за подписку на канал получена!</p>
         </div>
      </section>

      <!-- Блок 2: История анализов -->
      <section class="history card">
        <h2>История анализов</h2>
        <div v-if="userStore.isLoadingHistory">Загрузка истории...</div>
        <div v-else-if="userStore.errorHistory" class="error-message">
          Ошибка загрузки истории: {{ userStore.errorHistory }}
        </div>
        <!-- Отображаем список ТОЛЬКО если история НЕ пуста -->
        <div v-else-if="userStore.history && userStore.history.length > 0">
          <AnalysisHistoryList :history="userStore.history" />
        </div>
        <div v-else>
          <p>У вас пока нет сохраненных анализов.</p>
        </div>
      </section>

      <!-- Модальное окно смены тарифа -->
      <SubscriptionModal
        v-if="userStore.showSubscriptionModal"
        @close="userStore.closeSubscriptionModal"
      />
    </template>

    <!-- "Отдельная страница" для получения награды -->
    <template v-else>
       <div class="reward-claim-view card">
           <!-- ... (содержимое страницы награды без изменений) ... -->
           <h1>🎁 Бесплатный токен за подписку</h1>
           <p>Чтобы получить 1 токен для анализа вашего первого сна, пожалуйста, выполните два простых шага:</p>
            <ol class="steps">
                <li><span>1. Подпишитесь на наш канал в Telegram:</span><a href="https://t.me/TheDreamsHub" target="_blank" rel="noopener noreferrer" class="subscribe-button">Перейти и подписаться на @TheDreamsHub</a><span class="hint">(Откроется в Telegram, затем вернитесь сюда)</span></li>
                <li><span>2. Нажмите кнопку ниже, чтобы мы проверили подписку:</span><button @click="handleClaimRewardClick" :disabled="userStore.isClaimingReward" class="claim-button"><span v-if="userStore.isClaimingReward">Проверяем подписку... <span class="spinner"></span></span><span v-else>Я подписался, проверить и получить токен</span></button></li>
            </ol>
            <p v-if="userStore.claimRewardSuccessMessage" class="success-message">✅ {{ userStore.claimRewardSuccessMessage }} Токен добавлен к вашему балансу.<button @click="goBackToAccount" class="back-button">Вернуться в ЛК</button></p>
            <p v-if="userStore.claimRewardError && !userStore.claimRewardSuccessMessage" class="error-message">⚠️ {{ userStore.claimRewardError }}</p>
            <p v-if="userStore.userCheckedSubscription && userStore.claimRewardError?.includes('Подписка на канал не найдена')" class="info-message">Пожалуйста, убедитесь, что вы подписаны на канал <a href="https://t.me/TheDreamsHub" target="_blank">@TheDreamsHub</a>, и попробуйте проверить снова.</p>
            <button v-if="!userStore.claimRewardSuccessMessage && !userStore.claimRewardError" @click="goBackToAccount" class="back-button secondary">Назад в Личный кабинет</button>
       </div>
    </template>

  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useUserStore } from '@/stores/user';
import AnalysisHistoryList from '@/components/AnalysisHistoryList.vue';
import SubscriptionModal from '@/components/SubscriptionModal.vue';

const userStore = useUserStore();
const tg = window.Telegram?.WebApp;
const showRewardClaimView = ref(false);

const goBackToAccount = () => {
    showRewardClaimView.value = false;
    userStore.claimRewardError = null;
    userStore.claimRewardSuccessMessage = null;
    userStore.userCheckedSubscription = false;
    // Обновляем профиль И историю при возврате в ЛК
    userStore.fetchProfile();
    userStore.fetchHistory(); // <<<--- ДОБАВЛЕНА ЗАГРУЗКА ИСТОРИИ ПРИ ВОЗВРАТЕ
};

const handleClaimRewardClick = async () => { await userStore.claimChannelReward(); };

onMounted(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isClaimRewardAction = urlParams.get('action') === 'claim_reward';
    showRewardClaimView.value = isClaimRewardAction; // Устанавливаем вид сразу

    console.log(`[PersonalAccount onMounted] Initial view: ${isClaimRewardAction ? 'Reward Claim' : 'Main Account'}`);

    if (tg) {
        tg.ready();
        console.log("[PersonalAccount] Telegram WebApp is ready.");
        tg.BackButton.show();
        tg.BackButton.onClick(() => {
            // <<<--- ДОБАВЛЕН ЛОГ ВНУТРИ КНОПКИ НАЗАД ---
            console.log(`[PersonalAccount BackButton] Clicked. Modal open: ${userStore.showSubscriptionModal}, Reward view: ${showRewardClaimView.value}`);
            if (userStore.showSubscriptionModal) {
                userStore.closeSubscriptionModal();
            } else if (showRewardClaimView.value === true) { // <<<--- Явная проверка на true
                goBackToAccount(); // Если на странице награды, возвращаемся в ЛК
            } else {
                console.log("[PersonalAccount BackButton] Closing TMA.");
                tg.close(); // Иначе (в основном ЛК) закрываем приложение
            }
        });
        if (tg.MainButton.isVisible) { tg.MainButton.hide(); }
    } else { console.warn("[PersonalAccount] Telegram WebApp API not available."); }

    // Загружаем профиль всегда
    console.log("[PersonalAccount onMounted] Fetching profile...");
    await userStore.fetchProfile();
    console.log("[PersonalAccount onMounted] Profile fetched.");

    // Историю грузим только если мы в основном ЛК
    if (!showRewardClaimView.value) {
         console.log("[PersonalAccount onMounted] Fetching history...");
        await userStore.fetchHistory();
        console.log("[PersonalAccount onMounted] History fetched.");
    }
});

// Форматирование даты (без изменений)
const formatDate = (dateString) => { if (!dateString) return ''; try { return new Date(dateString).toLocaleDateString(); } catch (e) { return dateString; } };

// Слежение за получением награды для авто-возврата (без изменений)
watch(() => userStore.profile.channel_reward_claimed, (newValue, oldValue) => {
  if (newValue === true && oldValue === false && showRewardClaimView.value) {
    console.log("[PersonalAccount] Reward claimed successfully, auto-returning to account view soon.");
    setTimeout(() => { if (showRewardClaimView.value) { goBackToAccount(); } }, 3500);
  }
});
</script>

<style scoped>
/* --- Стили без изменений --- */
/* ... (все ваши стили) ... */
</style>
