const { Telegraf } = require('telegraf');
const axios = require('axios');
const { getUser, createUser, createAnalysis } = require('../src/database');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
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

bot.on('text', async (ctx) => {
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
    const response = await axios.post('https://api.openai.com/v1/completions', {
      model: 'text-davinci-003',
      prompt: `Проанализируй сон: "${dreamText}". Объясни его значение.`,
      max_tokens: 500,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    const analysis = response.data.choices[0].text.trim();
    const analysisRecord = await createAnalysis(user.id, dreamText, analysis);
    if (!analysisRecord) {
      return ctx.reply('Ошибка: не удалось сохранить анализ. Попробуйте позже.');
    }

    user.tokens -= 1;
    const { error } = await supabase.from('users').update({ tokens: user.tokens }).eq('id', user.id);
    if (error) {
      console.error('Ошибка обновления токенов:', error);
      return ctx.reply('Ошибка: не удалось обновить токены. Попробуйте позже.');
    }

    ctx.reply(`✨ *Анализ сна:*\n\n${analysis}`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ошибка анализа сна:', err.message);
    ctx.reply('Ошибка при анализе сна. Попробуйте позже.');
  }
});

bot.launch();
module.exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Ошибка обработки обновления:', err);
    return { statusCode: 500, body: 'Error' };
  }
};
