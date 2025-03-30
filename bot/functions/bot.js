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

bot.start(async (ctx) => {
  console.log('Получена команда /start от:', ctx.from);
  const tgId = ctx.from.id;

  let user = await getUser(tgId);
  if (!user) {
    user = await createUser(tgId);
    if (!user) {
      return ctx.reply('Ошибка: не удалось создать пользователя. Попробуйте позже.');
    }
  }

  ctx.reply(
    '🌙 *Добро пожаловать в Dream Analyzer!*\n\n' +
    'У вас есть 1 токен для первого анализа сна. Опишите свой сон, и я помогу его интерпретировать.\n\n' +
    'Вы также можете открыть личный кабинет для управления тарифами и просмотра истории анализов.',
    {
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
    }
  );
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
    return ctx.reply(
      'У вас закончились токены. Пожалуйста, пополните баланс в личном кабинете.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Пополнить баланс',
                web_app: { url: 'https://tourmaline-eclair-9d40ea.netlify.app' },
              },
            ],
          ],
        },
      }
    );
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
                text: `Проанализируй сон: "${dreamText}". Объясни его значение на русском языке в пределах 300 символов.`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 100, // Ограничение токенов для ~300 символов
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
    if (analysis.length > 300) {
      analysis = analysis.substring(0, 297) + '...';
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

    // Предложение пополнить баланс
    await ctx.reply(
      'Хотите продолжить анализировать сны? Пополните баланс токенов в личном кабинете!',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Пополнить баланс',
                web_app: { url: 'https://tourmaline-eclair-9d40ea.netlify.app' },
              },
            ],
          ],
        },
      }
    );
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
