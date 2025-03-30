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
             <!-- Можно добавить скидку как в примере -->
             <!-- <span class="save">Save X%</span> -->
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

      <!-- Кнопка Оплаты -->
      <button
        class="pay-button"
        :disabled="!userStore.selectedInvoiceAmount"
        @click="handlePayment"
      >
        <span v-if="userStore.selectedInvoiceAmount">
            Оплатить {{ userStore.selectedInvoiceAmount }} <span class="stars-icon">⭐</span>
        </span>
        <span v-else>Выберите план</span>
      </button>

    </div>
  </div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const { getPlanDetails } = userStore; // Получаем геттер из стора

const emit = defineEmits(['close']);

const closeModal = () => {
  emit('close');
};

const handlePayment = () => {
    // Вызываем action из стора
    userStore.initiatePayment();
};
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--tg-theme-secondary-bg-color);
  padding: 20px;
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  position: relative;
  color: var(--tg-theme-text-color);
  max-height: 80vh;
  overflow-y: auto;
}

.close-button {
  position: absolute;
  top: 10px;
  right: 10px;
  background: none;
  border: none;
  font-size: 1.8em;
  color: var(--tg-theme-hint-color);
  cursor: pointer;
}

h2 {
    text-align: center;
    margin-bottom: 15px;
}

/* Стили для табов */
.tabs {
  display: flex;
  justify-content: center;
  margin-bottom: 15px;
  background-color: var(--tg-theme-bg-color);
  border-radius: 8px;
  padding: 5px;
}
.tabs button {
  flex: 1;
  padding: 10px;
  border: none;
  background-color: transparent;
  color: var(--tg-theme-text-color);
  cursor: pointer;
  border-radius: 6px;
  font-size: 1em;
  transition: background-color 0.2s ease;
}
.tabs button.active {
  background-color: var(--tg-theme-button-color);
  color: var(--tg-theme-button-text-color);
  font-weight: bold;
}

/* Стили для выбора длительности */
.duration-options {
  display: flex;
  flex-direction: column;
  gap: 10px; /* Отступ между карточками */
  margin-bottom: 20px;
}
.duration-label {
  display: block; /* Чтобы карточка занимала всю ширину */
}
.duration-label input[type="radio"] {
  display: none; /* Скрываем стандартный radio */
}
.duration-card {
  border: 2px solid var(--tg-theme-hint-color);
  border-radius: 8px;
  padding: 12px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.duration-label input[type="radio"]:checked + .duration-card {
  border-color: var(--tg-theme-button-color);
  background-color: rgba(var(--tg-theme-button-rgb-color, 82, 179, 244), 0.1); /* Легкий фон */
}
.months {
    font-weight: 500;
}
.price {
    color: var(--tg-theme-hint-color);
    font-size: 0.9em;
}
.total-price {
    font-weight: bold;
}
.stars-icon {
    vertical-align: middle;
}


/* Список фич */
.features-list {
    margin-bottom: 20px;
    font-size: 0.95em;
    padding-left: 10px;
}
.features-list h3 {
    font-size: 1.1em;
    margin-bottom: 8px;
}
.features-list ul {
    list-style: none;
    padding: 0;
    margin: 0;
}
.features-list li {
    margin-bottom: 5px;
}


/* Кнопка оплаты */
.pay-button {
  display: block;
  width: 100%;
  padding: 12px;
  background-color: var(--tg-theme-button-color);
  color: var(--tg-theme-button-text-color);
  border: none;
  border-radius: 8px;
  font-size: 1.1em;
  font-weight: bold;
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.pay-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
