const { Telegraf } = require('telegraf');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { getUser, createUser, createAnalysis } = require('../src/database');

console.log('Инициализация Supabase...');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Установлен' : 'Не установлен');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
  const data = ctx.webAppData.data;
  const tgId = ctx.from.id;

  console.log(`Получены данные: ${data}, tgId: ${tgId}`);

  if (data === 'basic' || data === 'premium') {
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
      basic: { tokens: 15, stars: 1 },
      premium: { tokens: 30, stars: 1 },
    };

    const selectedTariff = prices[data];
    if (!selectedTariff) {
      console.log('Недопустимый тариф:', data);
      return ctx.reply('Ошибка: выбранный тариф недоступен.');
    }

    try {
      console.log('Отправка инвойса...');
      await ctx.replyWithInvoice(
        `Тариф ${data.charAt(0).toUpperCase() + data.slice(1)}`,
        `Получите ${selectedTariff.tokens} токенов за ${selectedTariff.stars} Stars`,
        JSON.stringify({ tariff: data, tgId }),
        process.env.PAYMENT_PROVIDER_TOKEN,
        'XTR',
        [
          { label: `Тариф ${data}`, amount: selectedTariff.stars },
        ]
      );
      console.log('Инвойс отправлен');
    } catch (err) {
      console.error('Ошибка отправки инвойса:', err.message);
      ctx.reply('Ошибка при создании инвойса. Попробуйте позже.');
    }
  } else if (data.startsWith('fetch:')) {
    // Обработка запросов от Mini App
    const query = data.replace('fetch:', '');
    let responseData;

    try {
      if (query === `/users/${tgId}`) {
        const user = await getUser(tgId);
        if (!user) {
          throw new Error('Пользователь не найден');
        }
        responseData = user;
      } else if (query === `/users/${tgId}/analyses`) {
        const user = await getUser(tgId);
        if (!user) {
          throw new Error('Пользователь не найден');
        }
        let queryBuilder = supabase
          .from('analyses')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (user.subscription_type === 'trial') {
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          queryBuilder = queryBuilder.gt('created_at', twentyFourHoursAgo);
        } else if (user.subscription_type === 'basic') {
          queryBuilder = queryBuilder.limit(3);
        } else if (user.subscription_type === 'premium') {
          queryBuilder = queryBuilder.limit(5);
        }

        const { data: analyses, error } = await queryBuilder;
        if (error) {
          throw new Error('Ошибка получения анализов: ' + error.message);
        }
        responseData = analyses;
      } else {
        throw new Error('Недопустимый запрос');
      }

      // Отправляем данные обратно в Mini App через answerWebAppQuery
      await ctx.answerWebAppQuery({
        web_app_query_id: ctx.webAppData.query_id,
        result: {
          type: 'article',
          id: ctx.webAppData.query_id,
          title: 'Данные',
          input_message_content: {
            message_text: JSON.stringify(responseData),
          },
        },
      });
    } catch (err) {
      console.error('Ошибка обработки запроса от Mini App:', err.message);
      await ctx.answerWebAppQuery({
        web_app_query_id: ctx.webAppData.query_id,
        result: {
          type: 'article',
          id: ctx.webAppData.query_id,
          title: 'Ошибка',
          input_message_content: {
            message_text: JSON.stringify({ error: err.message }),
          },
        },
      });
    }
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

  try {
    const { error } = await supabase
      .from('users')
      .update({ subscription_type: tariff, tokens: user.tokens + selectedTariff.tokens })
      .eq('tg_id', tgId);
    if (error) {
      console.error('Ошибка обновления тарифа:', error.message);
      return ctx.reply('Ошибка при обновлении тарифа. Попробуйте позже.');
    }

    ctx.reply(`Тариф ${tariff} успешно активирован! У вас теперь ${user.tokens + selectedTariff.tokens} токенов.`);
  } catch (err) {
    console.error('Ошибка при обработке оплаты:', err.message);
    ctx.reply('Ошибка при обработке оплаты. Попробуйте позже.');
  }
});

bot.on('text', async (ctx) => {
  console.log('Получено текстовое сообщение:', ctx.message.text, 'от:', ctx.from);
  const tgId = ctx.from.id;
  const dreamText = ctx.message.text;

  if (dreamText.startsWith('/')) {
    return; // Пропускаем команды
  }

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

  try {
    await ctx.reply('Анализирую ваш сон...');

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
          maxOutputTokens: 400,
          temperature: 0.7,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );

    console.log('Ответ от Gemini API:', response.data);
    if (!response.data.candidates || !response.data.candidates[0].content.parts[0].text) {
      throw new Error('Некорректный ответ от Gemini API');
    }

    let analysis = response.data.candidates[0].content.parts[0].text.trim();
    if (response.data.candidates[0].finishReason === 'MAX_TOKENS') {
      analysis += '\n\n(Анализ обрезан из-за ограничения длины. Попробуйте описать сон короче.)';
    }

    console.log('Сохранение анализа в Supabase...');
    const analysisRecord = await createAnalysis(user.id, dreamText, analysis);
    if (!analysisRecord) {
      throw new Error('Не удалось сохранить анализ в Supabase');
    }

    console.log('Обновление токенов пользователя...');
    const { error } = await supabase
      .from('users')
      .update({ tokens: user.tokens - 1 })
      .eq('id', user.id);
    if (error) {
      throw new Error('Ошибка обновления токенов: ' + error.message);
    }

    console.log('Отправка ответа пользователю...');
    await ctx.reply(`✨ *Анализ сна:*\n\n${analysis}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ошибка анализа сна:', err.message);
    if (err.response) {
      console.error('Детали ошибки Gemini API:', err.response.data);
    }
    await ctx.reply('Ошибка при анализе сна. Попробуйте позже.');
  }
});

module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    console.log('Получено обновление:', body);
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Ошибка обработки обновления:', err.message);
    return { statusCode: 500, body: 'Error' };
  }
};
