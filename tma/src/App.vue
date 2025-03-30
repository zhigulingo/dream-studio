// tma/src/App.vue
<template>
  <!-- Пока просто отображаем Личный кабинет -->
  <!-- Если используете роутер, здесь будет <router-view /> -->
  <PersonalAccount />
</template>

<script setup>
// Импортируем главный компонент (или представление роутера)
import PersonalAccount from './views/PersonalAccount.vue'; // Убедитесь, что путь верный
</script>

<style>
/* Глобальные стили или стили для App.vue */
/* Можно импортировать CSS-файл: @import './assets/base.css'; */

/* Пример использования переменных Telegram для всего приложения */
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--tg-theme-text-color);
  background-color: var(--tg-theme-bg-color);
}
</style>
