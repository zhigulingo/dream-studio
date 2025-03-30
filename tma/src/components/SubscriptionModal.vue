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

      <!-- HTML Кнопка оплаты убрана -->

    </div>
  </div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import { watchEffect, onUnmounted, ref, onMounted } from 'vue'; // Импортируем все нужное

const userStore = useUserStore();
const { getPlanDetails } = userStore; // Это геттер, его можно использовать напрямую
const tg = window.Telegram?.WebApp;
const emit = defineEmits(['close']);

// Флаг монтирования компонента
const isMounted = ref(false);
onMounted(() => {
    isMounted.value = true;
    console.log("[SubscriptionModal] Component mounted");
});

const closeModal = () => {
  emit('close');
};

// Обработчик нажатия Main Button
const handleMainButtonClick = () => {
    console.log("[SubscriptionModal] Main Button clicked!");
    if (tg?.MainButton?.isActive) {
        userStore.initiatePayment(); // Вызываем action
    } else {
        console.warn("[SubscriptionModal] Main Button clicked but it was inactive.");
    }
};

// Следим за изменениями и монтированием для управления Main Button
watchEffect(() => {
  if (!tg || !isMounted.value) {
      // Если компонент не смонтирован или нет API TG
      if (tg?.MainButton?.isVisible) {
          console.log("[SubscriptionModal] Hiding Main Button (not mounted or no tg)");
           tg.MainButton.hide();
           tg.MainButton.offClick(handleMainButtonClick); // Снимаем обработчик на всякий случай
      }
      return; // Выходим
  }

  // Компонент смонтирован, API есть
  const amount = userStore.selectedInvoiceAmount; // Получаем актуальную цену

  if (amount) {
    // Настраиваем и показываем кнопку
    console.log(`[SubscriptionModal] Setting Main Button: Pay ${amount} Stars`);
    tg.MainButton.setParams({
      text: `Оплатить ${amount} ⭐`,
      color: tg.themeParams.button_color || '#2481CC',
      text_color: tg.themeParams.button_text_color || '#ffffff',
      is_active: true,
      is_visible: true,
    });
    // ВАЖНО: Переназначаем обработчик каждый раз при обновлении кнопки
    tg.MainButton.offClick(handleMainButtonClick);
    tg.MainButton.onClick(handleMainButtonClick);
  } else {
    // Если цена не выбрана (ошибка в логике цен?)
     console.log("[SubscriptionModal] Setting Main Button: Inactive (no amount)");
    tg.MainButton.setParams({
        text: 'Выберите план',
        is_active: false,
        is_visible: true // Оставляем видимой, но неактивной
    });
     tg.MainButton.offClick(handleMainButtonClick); // Снимаем обработчик
  }
});

// При размонтировании компонента (закрытии модалки)
onUnmounted(() => {
  if (tg?.MainButton?.isVisible) {
    tg.MainButton.hide();
    tg.MainButton.offClick(handleMainButtonClick); // Обязательно снимаем обработчик
     console.log("[SubscriptionModal] Main Button hidden on modal unmount.");
  }
  isMounted.value = false; // Сбрасываем флаг монтирования
});
</script>

<style scoped>
/* Стили остаются прежними */
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.6); display: flex;
  justify-content: center; align-items: center; z-index: 1000;
}
.modal-content {
  background-color: var(--tg-theme-secondary-bg-color); padding: 20px;
  border-radius: 12px; width: 90%; max-width: 400px; position: relative;
  color: var(--tg-theme-text-color); max-height: 80vh; overflow-y: auto;
}
.close-button {
  position: absolute; top: 10px; right: 10px; background: none; border: none;
  font-size: 1.8em; color: var(--tg-theme-hint-color); cursor: pointer;
}
h2 { text-align: center; margin-bottom: 15px; }
.tabs {
  display: flex; justify-content: center; margin-bottom: 15px;
  background-color: var(--tg-theme-bg-color); border-radius: 8px; padding: 5px;
}
.tabs button {
  flex: 1; padding: 10px; border: none; background-color: transparent;
  color: var(--tg-theme-text-color); cursor: pointer; border-radius: 6px;
  font-size: 1em; transition: background-color 0.2s ease;
}
.tabs button.active {
  background-color: var(--tg-theme-button-color); color: var(--tg-theme-button-text-color);
  font-weight: bold;
}
.duration-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.duration-label { display: block; }
.duration-label input[type="radio"] { display: none; }
.duration-card {
  border: 2px solid var(--tg-theme-hint-color); border-radius: 8px; padding: 12px 15px;
  display: flex; justify-content: space-between; align-items: center; cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.duration-label input[type="radio"]:checked + .duration-card {
  border-color: var(--tg-theme-button-color);
  background-color: rgba(var(--tg-theme-button-rgb-color, 82, 179, 244), 0.1);
}
.months { font-weight: 500; }
.price { color: var(--tg-theme-hint-color); font-size: 0.9em; }
.total-price { font-weight: bold; }
.stars-icon { vertical-align: middle; }
.features-list { margin-bottom: 20px; font-size: 0.95em; padding-left: 10px; }
.features-list h3 { font-size: 1.1em; margin-bottom: 8px; }
.features-list ul { list-style: none; padding: 0; margin: 0; }
.features-list li { margin-bottom: 5px; }
</style>
