const { Telegraf } = require('telegraf');
const axios = require('axios');
const { getUser, createUser, createAnalysis } = require('../src/database');

console.log('Инициализация бота...');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'Установлен' : 'Не установлен');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'Установлен' : 'Не установлен');

const bot = new Telegraf(process.env.BOT_TOKEN);

console.log('Бот создан, настройка обработчиков...');

bot.start((ctx) => {
  console.log('Получена команда /start от:', ctx.from);
  ctx.reply('🌙 *Добро пожаловать в Dream Analyzer!*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Открыть личный кабинет',
            web_app: { url: 'https://tourmaline-eclair-9d40ea.netlify.app' },
          },
        ],
      ],
    },
  });
});

bot.on('web_app_data', async (ctx) => {
  console.log('Получены данные от Mini App:', ctx.webAppData);
  const tariff = ctx.webAppData.data; // 'basic' или 'premium'
  const tgId = ctx.from.id;

  console.log(`Выбран тариф: ${tariff}, tgId: ${tgId}`);

  let user = await getUser(tgId);
  if (!user) {
    console.log('Пользователь не найден, создаем нового...');
    user = await createUser(tgId);
    if (!user) {
      console.log('Не удалось создать пользователя');
      return ctx.reply('Ошибка: пользователь не найден и не удалось создать нового.');
    }
  }

  const prices = {
    basic: { tokens: 15, stars: 1 }, // Обновлено: 1 Star
    premium: { tokens: 30, stars: 1 }, // Обновлено: 1 Star
  };

  const selectedTariff = prices[tariff];
  if (!selectedTariff) {
    console.log('Недопустимый тариф:', tariff);
    return ctx.reply('Ошибка: выбранный тариф недоступен.');
  }

  try {
    console.log('Отправка инвойса...');
    await ctx.replyWithInvoice(
      `Тариф ${tariff.charAt(0).toUpperCase() + tariff.slice(1)}`,
      `Получите ${selectedTariff.tokens} токенов за ${selectedTariff.stars} Stars`,
      JSON.stringify({ tariff, tgId }),
      process.env.PAYMENT_PROVIDER_TOKEN,
      'XTR',
      [
        { label: `Тариф ${tariff}`, amount: selectedTariff.stars },
      ]
    );
    console.log('Инвойс отправлен');
  } catch (err) {
    console.error('Ошибка отправки инвойса:', err);
    ctx.reply('Ошибка при создании инвойса. Попробуйте позже.');
  }
});

bot.on('pre_checkout_query', (ctx) => {
  console.log('Получен pre_checkout_query:', ctx.preCheckoutQuery);
  ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
  console.log('Успешная оплата:', ctx.message.successful_payment);
  const { tariff, tgId } = JSON.parse(ctx.message.successful_payment.invoice_payload);
  const prices = {
    basic: { tokens: 15 },
    premium: { tokens: 30 },
  };

  const selectedTariff = prices[tariff];
  if (!selectedTariff) {
    console.log('Недопустимый тариф при оплате:', tariff);
    return ctx.reply('Ошибка: тариф не найден.');
  }

  const user = await getUser(tgId);
  if (!user) {
    console.log('Пользователь не найден при оплате');
    return ctx.reply('Ошибка: пользователь не найден.');
  }

  const { error } = await supabase
    .from('users')
    .update({ subscription_type: tariff, tokens: user.tokens + selectedTariff.tokens })
    .eq('tg_id', tgId);
  if (error) {
    console.error('Ошибка обновления тарифа:', error);
    return ctx.reply('Ошибка при обновлении тарифа. Попробуйте позже.');
  }

  ctx.reply(`Тариф ${tariff} успешно активирован! У вас теперь ${user.tokens + selectedTariff.tokens} токенов.`);
});

bot.on('text', async (ctx) => {
  console.log('Получено текстовое сообщение:', ctx.message.text, 'от:', ctx.from);
  const tgId = ctx.from.id;
  const dreamText = ctx.message.text;

  let user = await getUser(tgId);
  if (!user) {
    user = await createUser(tgId);
    if (!user) {
      return ctx.reply('Ошибка: не удалось создать пользователя. Попробуйте позже.');
    }
  }

  if (!user.tokens || user.tokens <= 0) {
    return ctx.reply('У вас закончились токены. Пожалуйста, выберите тариф в личном кабинете.');
  }

  ctx.reply('Анализирую ваш сон...');

  try {
    console.log('Отправка запроса к Gemini API...');
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: `Проанализируй сон: "${dreamText}". Объясни его значение на русском языке.`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.7,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Ответ от Gemini API:', response.data);
    const analysis = response.data.candidates[0].content.parts[0].text.trim();

    console.log('Сохранение анализа в Supabase...');
    const analysisRecord = await createAnalysis(user.id, dreamText, analysis);
    if (!analysisRecord) {
      console.error('Не удалось сохранить анализ в Supabase');
      return ctx.reply('Ошибка: не удалось сохранить анализ. Попробуйте позже.');
    }

    console.log('Обновление токенов пользователя...');
    user.tokens -= 1;
    const { error } = await supabase.from('users').update({ tokens: user.tokens }).eq('id', user.id);
    if (error) {
      console.error('Ошибка обновления токенов:', error);
      return ctx.reply('Ошибка: не удалось обновить токены. Попробуйте позже.');
    }

    ctx.reply(`✨ *Анализ сна:*\n\n${analysis}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ошибка анализа сна:', err.message);
    if (err.response) {
      console.error('Детали ошибки:', err.response.data);
    }
    ctx.reply('Ошибка при анализе сна. Попробуйте позже.');
  }
});

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    console.log('Получено обновление:', body);
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Ошибка обработки обновления:', err);
    return { statusCode: 500, body: 'Error' };
  }
};
