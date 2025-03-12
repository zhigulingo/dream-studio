const { Telegraf } = require('telegraf');
const { validateDream, checkSubscription } = require('../src/utils');
const { getUser, updateUserTokens, storeAnalysis } = require('../src/database');
const { analyzeDream } = require('../src/gemini');
const { sendInvoice } = require('../src/payments');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);

// Команда 
bot.start((ctx) => {
  ctx.reply('🌙 *Добро пожаловать в Dream Analyzer!*', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Открыть личный кабинет',
            web_app: { url: 'https://tourmaline-eclair-9d40ea.netlify.app' } // Замените на URL вашего Mini App после деплоя
          }
        ]
      ]
    }
  });
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (!validateDream(text)) {
    ctx.reply('Ошибка: текст должен быть минимум 40 символов, содержать кириллицу и не состоять только из чисел или эмодзи.');
    return;
  }
  const isSubscribed = await checkSubscription(bot, ctx.from.id);
  if (!isSubscribed) {
    ctx.reply('Пожалуйста, подпишитесь на @TheDreamsHub для продолжения.');
    return;
  }
  const user = await getUser(ctx.from.id);
  if (user.tokens <= 0) {
    ctx.reply('У вас закончились токены. Выберите тариф: /buy_basic или /buy_premium');
    return;
  }
  await updateUserTokens(user.id, user.tokens - 1);
  ctx.reply('Анализирую ваш сон...');
  const analysis = await analyzeDream(text);
  await storeAnalysis(user.id, text, analysis);
  ctx.reply(`Анализ вашего сна: ${analysis}`);
});

// Команды для покупки тарифов
bot.command('buy_basic', (ctx) => sendInvoice(bot, ctx, 'basic'));
bot.command('buy_premium', (ctx) => sendInvoice(bot, ctx, 'premium'));

// Обработка платежей
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', async (ctx) => {
  const tariff = ctx.message.successful_payment.invoice_payload;
  const updates = {
    basic: { tokens: 15, subscription_type: 'basic' },
    premium: { tokens: 30, subscription_type: 'premium' },
  };
  const { error } = await supabase
    .from('users')
    .update(updates[tariff])
    .eq('tg_id', ctx.from.id);
  if (error) {
    ctx.reply('Ошибка при обновлении тарифа');
    return;
  }
  ctx.reply(`Спасибо за покупку тарифа ${tariff}!`);
});

// Экспорт функции для Netlify Functions
exports.handler = async (event, context) => {
  try {
    await bot.handleUpdate(JSON.parse(event.body));
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Error handling update:', error);
    return { statusCode: 500, body: 'Error' };
  }
};
