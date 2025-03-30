<template>
  <div class="modal-overlay" @click.self="closeModal">
    <div class="modal-content">
      <button class="close-button" @click="closeModal">×</button>
      <h2>Выберите план подписки</h2>

      <!-- Табы Basic/Premium -->
      <div class="tabs">
        <button
          :class="{ active: userStore.selectedPlan === 'basic' }"
          @click="userStore.selectPlan('basic')"
        >
          Basic
        </button>
        <button
          :class="{ active: userStore.selectedPlan === 'premium' }"
          @click="userStore.selectPlan('premium')"
        >
          Premium
        </button>
      </div>

      <!-- Опции длительности -->
      <div class="duration-options">
        <label v-for="duration in [1, 3, 12]" :key="duration" class="duration-label">
          <input
            type="radio"
            name="duration"
            :value="duration"
            :checked="userStore.selectedDuration === duration"
            @change="userStore.selectDuration(duration)"
          />
          <div class="duration-card">
             <span class="months">{{ duration }} {{ duration > 1 ? (duration < 5 ? 'месяца' : 'месяцев') : 'месяц' }}</span>
             <span class="price" v-if="getPlanDetails(userStore.selectedPlan, duration).price">
               {{ (getPlanDetails(userStore.selectedPlan, duration).price / duration).toFixed(0) }} / мес
             </span>
             <span class="total-price" v-if="getPlanDetails(userStore.selectedPlan, duration).price">
               Всего: {{ getPlanDetails(userStore.selectedPlan, duration).price }} <span class="stars-icon">⭐</span>
             </span>
          </div>
        </label>
      </div>

       <!-- Описание фич -->
      <div class="features-list">
        <h3>Что вы получаете:</h3>
        <ul>
          <li v-for="(feature, index) in getPlanDetails(userStore.selectedPlan, userStore.selectedDuration).features" :key="index">
            ✔️ {{ feature }}
          </li>
        </ul>
      </div>

      <!-- Кнопка Оплаты УБРАНА из HTML -->
      <!--
      <button
        class="pay-button"
        :disabled="!userStore.selectedInvoiceAmount"
        @click="handlePayment"
      > ... </button>
      -->

    </div>
  </div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
// <<<--- ДОБАВЛЕНО: Импортируем watchEffect и onUnmounted ---
import { watchEffect, onUnmounted } from 'vue';

const userStore = useUserStore();
const { getPlanDetails } = userStore;
const tg = window.Telegram?.WebApp; // Получаем объект WebApp

const emit = defineEmits(['close']);

const closeModal = () => {
  emit('close');
};

// <<<--- ИЗМЕНЕНО: Функция обработки нажатия Main Button ---
const handleMainButtonClick = () => {
    console.log("Main Button clicked!");
    userStore.initiatePayment(); // Вызываем action из стора
};

// <<<--- ДОБАВЛЕНО: Логика управления Main Button ---
watchEffect(() => {
  if (!tg) return; // Если API Telegram недоступно, ничего не делаем

  const amount = userStore.selectedInvoiceAmount;

  if (amount) {
    // Если цена выбрана, настраиваем и показываем кнопку
    tg.MainButton.setParams({
      text: `Оплатить ${amount} ⭐`,
      color: tg.themeParams.button_color || '#2481CC', // Используем цвет темы
      text_color: tg.themeParams.button_text_color || '#ffffff',
      is_active: true, // Кнопка активна
      is_visible: true, // Кнопка видима
    });
    // Назначаем обработчик (ВАЖНО: сначала убираем старый, если был)
    tg.MainButton.offClick(handleMainButtonClick);
    tg.MainButton.onClick(handleMainButtonClick);
  } else {
    // Если цена не выбрана (например, ошибка), делаем кнопку неактивной или прячем
    tg.MainButton.setParams({
        text: 'Выберите план',
        is_active: false,
        is_visible: true // Оставляем видимой, но неактивной
    });
     tg.MainButton.offClick(handleMainButtonClick); // Снимаем обработчик
  }
});

// <<<--- ДОБАВЛЕНО: Прячем кнопку при размонтировании компонента (закрытии модалки) ---
onUnmounted(() => {
  if (tg?.MainButton?.isVisible) {
    tg.MainButton.hide();
    tg.MainButton.offClick(handleMainButtonClick); // Убираем обработчик
     console.log("Main Button hidden on modal close.");
  }
});

</script>

<style scoped>
/* Стили остаются те же, но .pay-button можно удалить */
.modal-overlay { /* ... */ }
.modal-content { /* ... */ }
.close-button { /* ... */ }
/* ... остальные стили ... */
</style>
