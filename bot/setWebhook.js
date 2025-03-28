const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = 'https://sparkling-cupcake-940504.netlify.app/.netlify/functions/bot';

async function setWebhook() {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}`
    );
    console.log('Вебхук установлен:', response.data);
  } catch (err) {
    console.error('Ошибка установки вебхука:', err.message);
    if (err.response) {
      console.error('Детали ошибки:', err.response.data);
    }
    process.exit(1); // Останавливаем деплой, если вебхук не установлен
  }
}

setWebhook();
