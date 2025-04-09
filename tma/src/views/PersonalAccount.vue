<template>
  <div class="personal-account">
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
        <button @click="userStore.openSubscriptionModal" class="change-plan-button">
          Сменить тариф
        </button>
      </div>
       <div v-else>
            <p>Не удалось загрузить профиль.</p> <!-- Сообщение, если токены null после загрузки -->
       </div>
      <div v-if="userStore.showClaimRewardSection" class="reward-section card">
      <h2>🎁 Получите бесплатный токен!</h2>
      <p>Подпишитесь на наш канал, чтобы получить 1 токен для анализа вашего первого сна.</p>

      <ol class="steps">
          <li>
              <span>Нажмите на кнопку и подпишитесь на канал:</span>
              <a href="https://t.me/TheDreamsHub" target="_blank" rel="noopener noreferrer" class="subscribe-button">
                  Подписаться на @TheDreamsHub
              </a>
          </li>
          <li>
              <span>Вернитесь сюда и нажмите кнопку ниже, чтобы проверить подписку и получить токен.</span>
              <button
                @click="userStore.claimChannelReward"
                :disabled="!userStore.canAttemptClaim"
                class="claim-button"
              >
                <span v-if="userStore.isClaimingReward">Проверяем... <span class="spinner"></span></span>
                <span v-else>Проверить подписку и получить токен</span>
              </button>
          </li>
      </ol>

      <!-- Сообщения о статусе -->
      <p v-if="userStore.claimRewardSuccessMessage" class="success-message">
          ✅ {{ userStore.claimRewardSuccessMessage }}
      </p>
      <p v-if="userStore.claimRewardError" class="error-message">
          ⚠️ {{ userStore.claimRewardError }}
      </p>
       <!-- Подсказка, если пользователь нажал кнопку, но не был подписан -->
       <p v-if="!userStore.claimRewardSuccessMessage && !userStore.rewardAlreadyClaimed && userStore.userCheckedSubscription && !userStore.isClaimingReward && !userStore.claimRewardError?.includes('уже была получена')" class="info-message">
           Не забудьте подписаться перед проверкой!
       </p>

    </div>
     <!-- Сообщение, если награда УЖЕ получена -->
     <div v-else-if="!userStore.isLoadingProfile && userStore.profile?.channel_reward_claimed" class="reward-section-claimed card">
         <p>✅ Вы уже получили награду за подписку на канал!</p>
     </div>
    </section>

    <!-- Блок 2: История анализов -->
    <section class="history card">
      <h2>История анализов</h2>
       <div v-if="userStore.isLoadingHistory">Загрузка истории...</div>
       <div v-else-if="userStore.errorHistory" class="error-message">
         Ошибка загрузки истории: {{ userStore.errorHistory }}
       </div>
       <div v-else-if="userStore.history.length > 0">
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

  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useUserStore } from '@/stores/user'; // Путь к вашему стору
import AnalysisHistoryList from '@/components/AnalysisHistoryList.vue'; // Компонент истории
import SubscriptionModal from '@/components/SubscriptionModal.vue'; // Компонент модалки

const userStore = useUserStore();
const tg = window.Telegram?.WebApp;

onMounted(async () => {
    if (tg) {
        tg.ready();
        console.log("[PersonalAccount] Telegram WebApp is ready.");
        // Управляем кнопкой Назад
        tg.BackButton.show();
        tg.BackButton.onClick(() => {
            // Если модалка открыта, сначала закрываем ее
             if (userStore.showSubscriptionModal) {
                userStore.closeSubscriptionModal();
             } else {
                // Иначе закрываем приложение
                 tg.close();
             }
        });
        // Важно: Прячем Main Button при первоначальной загрузке ЛК
        if (tg.MainButton.isVisible) {
            tg.MainButton.hide();
        }
    } else {
        console.warn("[PersonalAccount] Telegram WebApp API not available.");
    }
    // Загружаем данные
  await userStore.fetchProfile();
  await userStore.fetchHistory();
});

const formatDate = (dateString) => {
  if (!dateString) return '';
  try { return new Date(dateString).toLocaleDateString(); } catch (e) { return dateString; }
};
const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'claim_reward') {
      console.log("TMA opened with action=claim_reward");
};

</script>

<style scoped>
/* Стили остаются прежними */
.personal-account { padding: 15px; color: var(--tg-theme-text-color); background-color: var(--tg-theme-bg-color); }
.card { background-color: var(--tg-theme-secondary-bg-color); border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
h1, h2 { color: var(--tg-theme-text-color); margin-top: 0; margin-bottom: 10px; }
.capitalize { text-transform: capitalize; }
.error-message { color: var(--tg-theme-destructive-text-color); background-color: rgba(255, 0, 0, 0.1); padding: 8px; border-radius: 4px; }
.change-plan-button { background-color: var(--tg-theme-button-color); color: var(--tg-theme-button-text-color); border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-size: 1em; margin-top: 10px; transition: background-color 0.2s ease; }
.change-plan-button:hover { opacity: 0.9; }
.reward-section h2 {
    margin-top: 0;
    color: var(--tg-theme-text-color);
}

.reward-section p {
    margin-bottom: 15px;
    line-height: 1.5;
}

.steps {
    list-style: none;
    padding-left: 0;
    margin-top: 20px;
}

.steps li {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-start; /* Кнопки под текстом */
}

.steps li span {
     display: block;
     margin-bottom: 8px;
     font-weight: 500;
}

.subscribe-button, .claim-button, .subscribe-button-main {
    display: inline-block;
    padding: 10px 15px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: bold;
    cursor: pointer;
    border: none;
    text-align: center;
    margin-top: 5px; /* Небольшой отступ сверху */
    width: auto; /* Авто ширина по контенту */
     min-width: 200px; /* Минимальная ширина для читаемости */
}

.subscribe-button {
    background-color: var(--tg-theme-button-color); /* Цвет кнопки ТГ */
    color: var(--tg-theme-button-text-color);
}
.subscribe-button:hover {
    opacity: 0.9;
}

.claim-button {
    background-color: #28a745; /* Зеленый для действия */
    color: white;
}
.claim-button:disabled {
    background-color: #cccccc; /* Серый неактивный */
    color: #666666;
    cursor: not-allowed;
     opacity: 0.7;
}

.subscribe-button-main {
     background-color: var(--tg-theme-link-color); /* Или другой цвет */
     color: white; /* Или var(--tg-theme-button-text-color) */
     margin-top: 20px;
     width: 100%; /* Растянуть на всю ширину */
}


.success-message {
    color: #28a745; /* Зеленый */
    font-weight: bold;
    margin-top: 15px;
}

.error-message {
    color: #dc3545; /* Красный */
    font-weight: bold;
    margin-top: 15px;
}
.info-message {
    color: var(--tg-theme-hint-color);
    font-size: 0.9em;
    margin-top: 10px;
}

.reward-section-claimed p {
    color: #28a745;
    font-weight: 500;
    text-align: center;
}

.spinner {
  display: inline-block;
  border: 2px solid rgba(255,255,255,.3);
  border-radius: 50%;
  border-top-color: #fff;
  width: 1em;
  height: 1em;
  animation: spin 1s ease-in-out infinite;
  margin-left: 5px;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Стили для остальной части ЛК */
h1, h2 {
    color: var(--tg-theme-text-color);
}
</style>
