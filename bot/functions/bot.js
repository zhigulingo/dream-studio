// Используем require для импорта в Node.js среде Netlify Functions (CommonJS)
const { Bot, session } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Переменные Окружения (Netlify их предоставляет) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Используем Service Role Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL || "YOUR_TMA_URL"; // Замените YOUR_TMA_URL или добавьте переменную в Netlify

// --- Проверка наличия переменных ---
if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error("CRITICAL ERROR: Missing required environment variables!");
  // Завершать процесс в лямбде не лучшая идея, просто логируем критическую ошибку
  // throw new Error("Missing required environment variables!"); // Можно раскомментировать, чтобы функция завершилась с ошибкой
}

// --- Инициализация Клиентов ---
let supabaseAdmin;
let genAI;
let geminiModel;

try {
    // Клиент Supabase с правами администратора (Service Role)
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
    console.log("Supabase Admin Client initialized.");

    // Клиент Google Generative AI
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log("Gemini Client initialized (model gemini-pro).");

} catch (initError) {
    console.error("CRITICAL ERROR during client initialization:", initError);
    // Если инициализация не удалась, бот работать не сможет
    // throw initError; // Можно раскомментировать
}

// --- Функции ---

/**
 * Получает или создает пользователя в базе данных.
 * @param {number} userId - Telegram User ID
 * @returns {Promise<number | null>} ID пользователя в таблице users или null в случае ошибки
 */
async function getOrCreateUser(userId) {
  if (!supabaseAdmin) {
      console.error("Supabase client not initialized in getOrCreateUser");
      return null;
  }
  try {
    let { data: existingUser, error: selectError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tg_id', userId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 - код "No rows found"
      console.error(`Error finding user ${userId}:`, selectError);
      return null;
    }

    if (existingUser) {
      return existingUser.id;
    } else {
      console.log(`User ${userId} not found, creating...`);
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          tg_id: userId,
          subscription_type: 'free',
          tokens: 1 // Даем 1 пробный токен
        })
        .select('id')
        .single();

      if (insertError) {
        console.error(`Error creating user ${userId}:`, insertError);
        return null;
      }

      if (newUser) {
        console.log(`Created new user: tg_id=${userId}, id=${newUser.id}`);
        return newUser.id;
      } else {
        console.error(`Failed to get new user ID for ${userId} after insert.`);
        return null;
      }
    }
  } catch (error) {
    console.error(`Critical error in getOrCreateUser for ${userId}:`, error);
    return null;
  }
}

/**
 * Получает анализ сна от Gemini API.
 * @param {string} dreamText - Текст сна.
 * @returns {Promise<string | null>} Строку с анализом или строку с ошибкой/предупреждением.
 */
async function getGeminiAnalysis(dreamText) {
  if (!geminiModel) {
      console.error("Gemini client not initialized in getGeminiAnalysis");
      return "Ошибка: Сервис анализа не инициализирован.";
  }
  if (!dreamText || dreamText.trim().length === 0) {
      return "Пожалуйста, опишите свой сон.";
  }
  const MAX_DREAM_LENGTH = 4000;
  if (dreamText.length > MAX_DREAM_LENGTH) {
      return `Извините, ваш сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте описать его короче.`;
  }

  try {
    console.log("Requesting analysis from Gemini...");
    const prompt = `Ты - эмпатичный и опытный толкователь снов. Проанализируй следующий сон пользователя, сохраняя конфиденциальность и избегая медицинских диагнозов или предсказаний будущего.
Сон: "${dreamText}"

Предоставь анализ (2-4 абзаца), фокусируясь на:
1.  Возможных символах и их значениях в контексте сна.
2.  Преобладающих эмоциях и их связи с реальной жизнью пользователя (если это уместно).
3.  Общих темах или сообщениях, которые могут содержаться во сне.
Отвечай мягко, поддерживающе и понятно. Не давай прямых советов, что делать.`;

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;

    // Добавим проверку на safetyRatings (если есть блокировка)
    if (response.promptFeedback?.blockReason) {
        console.warn(`Gemini analysis blocked for safety reasons: ${response.promptFeedback.blockReason}`, response.promptFeedback.safetyRatings);
        return `К сожалению, анализ вашего сна не может быть выполнен из-за ограничений безопасности контента (${response.promptFeedback.blockReason}). Пожалуйста, попробуйте переформулировать описание сна.`;
    }

    const analysisText = response.text();

    console.log("Gemini analysis received.");
    if (!analysisText || analysisText.trim().length === 0) {
        console.error("Gemini returned an empty response.");
        return "К сожалению, не удалось получить анализ для вашего сна в данный момент (пустой ответ).";
    }

    return analysisText;

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    // Здесь можно добавить более детальное логирование ошибки error.message, error.stack
    return "Произошла ошибка при связи с сервисом анализа снов. Попробуйте позже.";
  }
}

/**
 * Обрабатывает запрос на анализ сна.
 * @param {object} ctx - Контекст Grammy.
 * @param {string} dreamText - Текст сна.
 */
async function analyzeDream(ctx, dreamText) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Не удалось идентифицировать пользователя.").catch(e => console.error("Reply error:", e));
    return;
  }
  if (!supabaseAdmin) {
      console.error("Supabase client not initialized in analyzeDream");
      await ctx.reply("Ошибка: Сервис базы данных не инициализирован.").catch(e => console.error("Reply error:", e));
      return;
  }

  // 1. Получаем или создаем пользователя в БД
  const userDbId = await getOrCreateUser(userId);
  if (!userDbId) {
      await ctx.reply("Произошла ошибка при доступе к вашему профилю. Попробуйте позже.").catch(e => console.error("Reply error:", e));
      return;
  }

  // 2. Пытаемся списать токен АТОМАРНО через RPC
  await ctx.reply("Проверяем наличие токенов...").catch(e => console.error("Reply error:", e));
  try {
      const { data: tokenDecremented, error: rpcError } = await supabaseAdmin
          .rpc('decrement_token_if_available', { user_tg_id: userId });

      if (rpcError) {
          console.error(`RPC error decrement_token_if_available for tg_id ${userId}:`, rpcError);
          await ctx.reply("Произошла внутренняя ошибка при проверке токенов. Попробуйте позже.").catch(e => console.error("Reply error:", e));
          return;
      }

      if (!tokenDecremented) {
          console.log(`Not enough tokens for user tg_id ${userId}.`);
          await ctx.reply("У вас закончились токены для анализа. Откройте Личный кабинет, чтобы пополнить баланс.", {
             reply_markup: {
                 inline_keyboard: [
                   [{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }],
                 ],
             },
          }).catch(e => console.error("Reply error:", e));
          return;
      }

      // 3. Если токен успешно списан - вызываем Gemini
      console.log(`Token decremented for tg_id ${userId}. Calling Gemini...`);
      // Используем editMessageText, чтобы заменить "Проверяем наличие токенов..."
      const processingMessage = await ctx.reply("Токен использован. Анализирую ваш сон... 🧠✨ Пожалуйста, подождите.").catch(e => console.error("Reply error:", e));

      const analysisResult = await getGeminiAnalysis(dreamText);

      // Проверяем, вернул ли Gemini ошибку или предупреждение (функция теперь возвращает их как строки)
      const isErrorResult = !analysisResult ||
                            analysisResult.startsWith("Извините,") ||
                            analysisResult.startsWith("Произошла ошибка") ||
                            analysisResult.startsWith("Пожалуйста,") ||
                            analysisResult.startsWith("К сожалению,") ||
                            analysisResult.startsWith("Ошибка:");

      // Удаляем сообщение "Анализирую ваш сон..." или изменяем его, если была ошибка
      if (processingMessage) {
          await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.error("Delete message error:", e));
      }

      if (isErrorResult) {
          await ctx.reply(analysisResult || "Не удалось получить анализ.").catch(e => console.error("Reply error:", e));
          console.warn(`Analysis for tg_id ${userId} failed or was blocked, but token was consumed.`);
          // TODO: Рассмотреть логику возврата токена при определенных ошибках Gemini (например, blockReason)
          return;
      }

      // 4. Сохраняем успешный анализ в БД
      const { error: insertAnalysisError } = await supabaseAdmin
          .from('analyses')
          .insert({
              user_id: userDbId,
              dream_text: dreamText,
              analysis: analysisResult // Сохраняем только успешный результат
          });

      if (insertAnalysisError) {
          console.error(`Error saving analysis for user_id ${userDbId}:`, insertAnalysisError);
          await ctx.reply("Ваш сон проанализирован, но произошла ошибка при сохранении результата в историю. Пожалуйста, попробуйте сохранить его вручную или свяжитесь с поддержкой.").catch(e => console.error("Reply error:", e));
          // Отправляем результат все равно, раз анализ успешен
          await ctx.reply(`Результат анализа:\n\n${analysisResult}`).catch(e => console.error("Reply error:", e));
          return;
      }

      // 5. Отправляем результат пользователю
      console.log(`Analysis for tg_id ${userId} successful, saved, and sent.`);
      await ctx.reply(`Вот анализ вашего сна:\n\n${analysisResult}\n\nВы можете посмотреть историю своих анализов в Личном кабинете.`, {
        reply_markup: {
            inline_keyboard: [
              [{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }],
            ],
        },
      }).catch(e => console.error("Reply error:", e));

  } catch (error) {
      console.error(`Critical error in analyzeDream for tg_id ${userId}:`, error);
      await ctx.reply("Произошла непредвиденная ошибка при обработке вашего сна. Мы уже разбираемся.").catch(e => console.error("Reply error:", e));
  }
}

// --- Настройка Бота ---
// Инициализируем бота только если есть токен
const bot = BOT_TOKEN ? new Bot(BOT_TOKEN) : null;

if (bot) {
    // Middleware для сессий (можно пока закомментировать, если не используется)
    // bot.use(session({ initial: () => ({}) }));

    // Обработчик команды /start
    bot.command("start", async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) {
        console.warn("Received /start without user ID");
        return;
      }
      console.log(`User ${userId} started bot.`);
      try {
          await getOrCreateUser(userId); // Ensure user exists
          await ctx.reply(
            "Добро пожаловать в Анализатор Снов! ✨\n\n" +
            "Я помогу вам разобраться в значениях ваших сновидений с помощью искусственного интеллекта.\n\n" +
            "У вас есть 1 бесплатный анализ. Просто опишите свой сон в следующем сообщении, и я постараюсь его растолковать.\n\n" +
            "Также вы можете открыть свой Личный кабинет для просмотра истории и управления токенами.",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }],
                ],
              },
            }
          ).catch(e => console.error("Reply error:", e));
      } catch(e) {
          console.error("Error in /start handler:", e);
          await ctx.reply("Произошла ошибка при инициализации. Попробуйте еще раз.").catch(e => console.error("Reply error:", e));
      }
    });

    // Обработчик текстовых сообщений (для анализа сна)
    bot.on("message:text", async (ctx) => {
      const dreamText = ctx.message.text;
      const userId = ctx.from?.id;
      if (!userId) {
          console.warn("Received text message without user ID");
          return;
      }
      console.log(`Received text from ${userId}: "${dreamText}"`);

      if (dreamText.startsWith('/')) {
        // Можно добавить ответ "Неизвестная команда" или просто игнорировать
        console.log(`Ignoring command: ${dreamText}`);
        return;
      }

      // Запускаем анализ сна
      await analyzeDream(ctx, dreamText);
    });

    // Обработчик ошибок бота
    bot.catch((err) => {
      const ctx = err.ctx;
      console.error(`Error while handling update ${ctx.update.update_id}:`);
      const e = err.error;
      if (e instanceof Error) {
        console.error("Error:", e.stack || e.message);
      } else {
        console.error("Unknown error object:", e);
      }
      // Не пытаемся ответить пользователю здесь, чтобы избежать зацикливания ошибок
    });

} else {
    console.error("CRITICAL ERROR: Bot token not found, bot cannot be initialized!");
}

// --- Экспорт для Netlify ---
// Используем стандартный `exports.handler` для CommonJS окружения Netlify
exports.handler = async (event) => {
    if (!bot) {
        console.error("Handler called but bot is not initialized!");
        return { statusCode: 500, body: "Internal Server Error: Bot not initialized" };
    }
    if (!event.body) {
         console.warn("Handler called without event body");
         return { statusCode: 400, body: "Bad Request: Missing event body" };
    }

    try {
        // Передаем тело запроса (которое содержит Update от Telegram) в grammy
        await bot.handleUpdate(JSON.parse(event.body));
        // Telegram ожидает ответ 200 OK, чтобы понять, что вебхук получен
        return { statusCode: 200, body: "" };
    } catch (error) {
        console.error("Error in Netlify handler:", error);
        // Возвращаем 500, чтобы Telegram мог повторить попытку (если настроено)
        return { statusCode: 500, body: "Internal Server Error" };
    }
};

console.log("Netlify function bot.js loaded."); // Лог при загрузке функции
