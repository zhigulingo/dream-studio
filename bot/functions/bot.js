// --- Импорты ---
const { Bot, GrammyError, HttpError } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Получение Переменных Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Глобальные Переменные (для хранения инициализированных клиентов) ---
let supabaseAdmin;
let geminiModel;
let botInstance; // Храним экземпляр бота здесь

// --- Функция Инициализации (вызывается один раз при старте функции) ---
function initializeClients() {
    let initError = false;
    console.log("Initializing clients...");

    // Проверка наличия переменных
    if (!BOT_TOKEN) {
        console.error("FATAL: BOT_TOKEN is missing!");
        initError = true;
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("FATAL: Supabase URL or Service Key is missing!");
        initError = true;
    }
    if (!GEMINI_API_KEY) {
        console.error("FATAL: GEMINI_API_KEY is missing!");
        initError = true;
    }
    if (!TMA_URL) {
        console.warn("Warning: TMA_URL is missing. Inline buttons might not work.");
        // Не фатально, но желательно
    }

    // Инициализация Supabase
    try {
        if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
            supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
                auth: { autoRefreshToken: false, persistSession: false }
            });
            console.log("Supabase Admin Client initialized.");
        } else {
             throw new Error("Missing Supabase credentials for client creation.");
        }
    } catch (e) {
        console.error("FATAL: Failed to initialize Supabase client:", e);
        initError = true;
    }

    // Инициализация Gemini
    try {
        if (GEMINI_API_KEY) {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" });
            console.log("Gemini Client initialized (model gemini-pro).");
        } else {
            throw new Error("Missing Gemini API Key for client creation.");
        }
    } catch (e) {
        console.error("FATAL: Failed to initialize Gemini client:", e);
        initError = true;
    }

    // Инициализация Бота (только если есть токен)
    try {
        if (BOT_TOKEN && !initError) { // Инициализируем бота, только если нет других фатальных ошибок
            botInstance = new Bot(BOT_TOKEN);
            console.log("Grammy Bot instance created.");
            // Настроим обработчики команд и сообщений прямо здесь
            setupBotHandlers(botInstance);
        } else if (!BOT_TOKEN) {
             throw new Error("BOT_TOKEN is missing, cannot create bot instance.");
        } else {
             throw new Error("Cannot create bot instance due to previous initialization errors.");
        }
    } catch(e) {
        console.error("FATAL: Failed to create Bot instance:", e);
        initError = true;
    }

    if (initError) {
        console.error("Initialization failed. Bot may not function correctly.");
        // Можно выбросить ошибку, чтобы Netlify показал сбой функции при запуске
        // throw new Error("Client initialization failed.");
    } else {
        console.log("All clients initialized successfully.");
    }
}

// --- Вспомогательные Функции ---

async function getOrCreateUser(userId) {
    if (!supabaseAdmin) throw new Error("Supabase client not available in getOrCreateUser.");
    try {
        let { data: existingUser, error: selectError } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('tg_id', userId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') throw selectError; // Re-throw other errors

        if (existingUser) {
            return existingUser.id;
        } else {
            const { data: newUser, error: insertError } = await supabaseAdmin
                .from('users')
                .insert({ tg_id: userId, subscription_type: 'free', tokens: 1 })
                .select('id')
                .single();
            if (insertError) throw insertError;
            if (!newUser) throw new Error("User creation returned no data.");
            console.log(`Created new user: tg_id=${userId}, id=${newUser.id}`);
            return newUser.id;
        }
    } catch (error) {
        console.error(`Error in getOrCreateUser for ${userId}:`, error.message);
        return null; // Возвращаем null при любой ошибке здесь
    }
}

async function getGeminiAnalysis(dreamText) {
    if (!geminiModel) throw new Error("Gemini client not available in getGeminiAnalysis.");
    const MAX_DREAM_LENGTH = 4000; // Примерное ограничение
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;

    try {
        console.log("Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = result.response;

        if (response.promptFeedback?.blockReason) {
            console.warn(`Gemini blocked: ${response.promptFeedback.blockReason}`);
            return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}). Попробуйте переформулировать.`;
        }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) {
            console.error("Gemini returned empty response.");
            return "К сожалению, не удалось получить анализ (пустой ответ).";
        }
        console.log("Gemini analysis received.");
        return analysisText;
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return "Ошибка при связи с сервисом анализа. Попробуйте позже.";
    }
}

async function analyzeDream(ctx, dreamText) {
    const userId = ctx.from?.id;
    if (!userId) {
        await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError);
        return;
    }
    if (!supabaseAdmin) { // Проверка на всякий случай
         await ctx.reply("Ошибка: Сервис базы данных не инициализирован.").catch(logReplyError);
         return;
    }

    let userDbId;
    let processingMessage; // Для обновления статуса

    try {
        // 1. Получаем/создаем пользователя
        userDbId = await getOrCreateUser(userId);
        if (!userDbId) {
            await ctx.reply("Ошибка доступа к профилю. Попробуйте позже.").catch(logReplyError);
            return;
        }

        // 2. Проверяем/списываем токен через RPC
        processingMessage = await ctx.reply("Проверяем токены...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabaseAdmin
            .rpc('decrement_token_if_available', { user_tg_id: userId });

        if (rpcError) throw new Error(`RPC Error: ${rpcError.message}`); // Пробрасываем ошибку RPC
        if (!tokenDecremented) {
            if (processingMessage) await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(logReplyError);
            await ctx.reply("У вас закончились токены. Пополните баланс в Личном кабинете.", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError);
            return;
        }

        // 3. Вызываем Gemini (обновляем сообщение для пользователя)
        if (processingMessage) {
            await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError);
        } else {
             await ctx.reply("Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError);
        }

        const analysisResult = await getGeminiAnalysis(dreamText);

        // Удаляем сообщение "Анализирую..."
        if (processingMessage) {
             await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("Could not delete status message:", e));
             processingMessage = null; // Сбрасываем, чтобы не пытаться удалить снова в блоке catch
        }

        const isErrorResult = !analysisResult || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));

        if (isErrorResult) {
            await ctx.reply(analysisResult || "Не удалось получить анализ.").catch(logReplyError);
            console.warn(`Analysis for ${userId} failed/blocked, token consumed.`);
            // TODO: Подумать о возврате токена при blockReason?
            return;
        }

        // 4. Сохраняем успешный анализ
        const { error: insertError } = await supabaseAdmin
            .from('analyses')
            .insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });

        if (insertError) {
            console.error(`Error saving analysis for user_id ${userDbId}:`, insertError);
            // Сообщаем об ошибке, но все равно отправляем результат
            await ctx.reply("Сон проанализирован, но не удалось сохранить в историю. Вот результат:\n\n" + analysisResult).catch(logReplyError);
            return;
        }

        // 5. Отправляем результат
        console.log(`Analysis for ${userId} successful.`);
        await ctx.reply(`Вот анализ вашего сна:\n\n${analysisResult}\n\nИстория доступна в Личном кабинете.`, {
            reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
        }).catch(logReplyError);

    } catch (error) {
        console.error(`Critical error in analyzeDream for ${userId}:`, error);
        // Если сообщение "Анализирую" еще висит и произошла ошибка, удалим его
         if (processingMessage) {
             await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("Could not delete status message on error:", e));
         }
        await ctx.reply("Произошла непредвиденная ошибка при обработке сна. Мы уже разбираемся.").catch(logReplyError);
    }
}

// --- Настройка Обработчиков Бота ---
function setupBotHandlers(bot) {
    if (!bot) return;

    // /start
    bot.command("start", async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) return;
        console.log(`User ${userId} started bot.`);
        try {
            await getOrCreateUser(userId); // Ensure user exists
            await ctx.reply(
                "Добро пожаловать в Анализатор Снов! ✨\n\n" +
                "Опишите свой сон, и я помогу его растолковать (у вас 1 бесплатный анализ).\n\n" +
                "Личный кабинет для истории и токенов 👇", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError);
        } catch (e) {
            console.error("Error in /start handler:", e);
            await ctx.reply("Ошибка инициализации. Попробуйте /start еще раз.").catch(logReplyError);
        }
    });

    // Text messages
    bot.on("message:text", async (ctx) => {
        const dreamText = ctx.message.text;
        const userId = ctx.from?.id;
        if (!userId) return;
        if (dreamText.startsWith('/')) {
            console.log(`Ignoring command: ${dreamText}`);
            // Можно добавить ответ "Неизвестная команда"
            // await ctx.reply("Неизвестная команда.").catch(logReplyError);
            return;
        }
        console.log(`Received text from ${userId}: "${dreamText.substring(0, 50)}..."`);
        await analyzeDream(ctx, dreamText);
    });

    // Error handler
    bot.catch((err) => {
        const ctx = err.ctx;
        const e = err.error;
        console.error(`Error while handling update ${ctx.update.update_id}:`);
        if (e instanceof GrammyError) {
            console.error("Error in request:", e.description);
        } else if (e instanceof HttpError) {
            console.error("Could not contact Telegram:", e);
        } else if (e instanceof Error) { // Ловим наши ошибки и ошибки библиотек
             console.error("Unhandled error:", e.stack || e.message);
        } else {
            console.error("Unknown error object:", e);
        }
        // Важно: Не отвечаем пользователю из bot.catch, чтобы избежать зацикливания
    });

    console.log("Bot handlers configured.");
}

// --- Вспомогательная функция для логирования ошибок Reply ---
function logReplyError(error) {
    console.error("Failed to send message to Telegram:", error);
}

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    try {
        // Инициализируем клиенты и бота только один раз при "холодном" старте
        // В последующих "теплых" вызовах они уже будут инициализированы
        if (!botInstance) {
            console.log("Cold start: Initializing clients and bot...");
            initializeClients();
        }

        // Проверяем, что бот точно создан после инициализации
        if (!botInstance) {
             console.error("Handler called but bot instance is still not available after initialization!");
             return { statusCode: 500, body: "Internal Server Error: Bot initialization failed" };
        }

        if (!event.body) {
            console.warn("Handler called without event body.");
            return { statusCode: 400, body: "Bad Request: Missing event body" };
        }

        // Парсим тело запроса
        let update;
        try {
             update = JSON.parse(event.body);
        } catch (e) {
             console.error("Failed to parse event body:", e);
             return { statusCode: 400, body: "Bad Request: Invalid JSON" };
        }

        // Передаем обновление в grammy
        // Не используем await bot.handleUpdate(), т.к. нам нужно сразу вернуть 200 OK Телеграму
        // grammy обработает обновление асинхронно
        botInstance.handleUpdate(update).catch((err) => {
             // Ловим ошибки, которые могли произойти асинхронно *после* ответа 200 OK
             console.error("Async error during update processing:", err);
        });

        // Немедленно возвращаем 200 OK, чтобы Telegram не повторял запрос
        return { statusCode: 200, body: "" };

    } catch (error) {
        // Ловим ошибки, возникшие *до* или *во время* вызова handleUpdate (синхронные ошибки)
        console.error("Error in Netlify handler:", error);
        // Возвращаем 500, но это может заставить Telegram повторить запрос
        return { statusCode: 500, body: "Internal Server Error" };
    }
};

// Вызываем инициализацию один раз при загрузке файла функции
// Это произойдет при первом вызове функции (холодный старт)
initializeClients();
console.log("Netlify function bot.js loaded and initial client setup triggered.");
