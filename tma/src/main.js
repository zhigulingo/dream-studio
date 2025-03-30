// tma/src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue' // Ваш корневой компонент Vue
// import router from './router' // Раскомментируйте, если используете Vue Router

// Импортируйте ваши глобальные стили, если есть
// import './assets/main.css'

const app = createApp(App)

app.use(createPinia()) // Подключаем Pinia
// app.use(router) // Подключаем роутер, если есть

app.mount('#app') // Монтируем приложение в <div id="app"> из index.html

// Инициализация Telegram WebApp API (не обязательно здесь, но удобно)
if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    console.log("Telegram WebApp is ready.");
    // window.Telegram.WebApp.expand(); // Можно раскрыть окно приложения при старте
} else {
    console.warn("Telegram WebApp script not loaded or executed.");
}
