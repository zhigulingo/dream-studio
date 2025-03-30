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

// --- Вспомогательные Функции (без изменений в логике) ---

async function getOrCreateUser(supabase, userId) {
    if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
    try {
        let { data: existingUser, error: selectError } = await supabase
            .from('users').select('id').eq('tg_id', userId).single();
        if (selectError && selectError.code !== 'PGRST116') throw selectError;
        if (existingUser) return existingUser.id;
        else {
            const { data: newUser, error: insertError } = await supabase
                .from('users').insert({ tg_id: userId, subscription_type: 'free', tokens: 1 }).select('id').single();
            if (insertError) throw insertError;
            if (!newUser) throw new Error("User creation returned no data.");
            console.log(`Created new user: tg_id=${userId}, id=${newUser.id}`);
            return newUser.id;
        }
    } catch (error) {
        console.error(`Error in getOrCreateUser for ${userId}:`, error.message); return null;
    }
}

async function getGeminiAnalysis(geminiModel, dreamText) {
    // <<<--- ИЗМЕНЕНО: Обернем вызов Gemini в try-catch здесь же, чтобы лучше логировать ошибку ---
    if (!geminiModel) {
         console.error("Gemini model is null or undefined in getGeminiAnalysis.");
         return "Ошибка: Сервис анализа не инициализирован."; // Возвращаем ошибку, если модель не передана
    }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;

    try {
        console.log("Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;

        // Используем generateContentAsync для потоковой передачи (хотя здесь мы ждем весь ответ)
        // Это иногда помогает с таймаутами и обработкой ошибок
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response; // Дожидаемся полного ответа

        if (response.promptFeedback?.blockReason) {
            console.warn(`Gemini blocked: ${response.promptFeedback.blockReason}`);
            return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}). Попробуйте переформулировать.`;
        }
        const analysisText = response.text(); // Получаем текст ответа
        if (!analysisText || analysisText.trim().length === 0) {
            console.error("Gemini returned empty response.");
            // Проверим, есть ли кандидаты вообще (может быть пустой ответ без ошибки)
            if (!response.candidates || response.candidates.length === 0) {
                 console.error("Gemini response candidates array is empty or missing.");
            } else {
                 console.log("Gemini response candidates:", JSON.stringify(response.candidates));
            }
            return "К сожалению, не удалось получить анализ (пустой ответ от сервиса).";
        }
        console.log("Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("Error explicitly caught in getGeminiAnalysis:", error); // Логируем ошибку здесь
        // Проверяем специфичные ошибки Google AI
         if (error.message && error.message.includes("API key not valid")) {
            return "Ошибка: Неверный ключ API для сервиса анализа.";
        } else if (error.status === 404 || (error.message && error.message.includes("404"))) {
             return "Ошибка: Модель анализа не найдена или недоступна. Свяжитесь с поддержкой.";
        }
        // Общая ошибка
        return "Ошибка при связи с сервисом анализа. Попробуйте позже.";
    }
}


async function analyzeDream(ctx, supabase, geminiModel, dreamText) {
    const userId = ctx.from?.id;
    if (!userId) { await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError); return; }
    let userDbId; let processingMessage;
    try {
        userDbId = await getOrCreateUser(supabase, userId);
        if (!userDbId) { await ctx.reply("Ошибка доступа к профилю. Попробуйте позже.").catch(logReplyError); return; }
        processingMessage = await ctx.reply("Проверяем токены...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabase
            .rpc('decrement_token_if_available', { user_tg_id: userId });
        if (rpcError) throw new Error(`RPC Error: ${rpcError.message}`);
        if (!tokenDecremented) {
            if (processingMessage) await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(logReplyError);
            await ctx.reply("У вас закончились токены. Пополните баланс в Личном кабинете.", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError); return;
        }
        if (processingMessage) { await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError); }
        else { await ctx.reply("Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError); }

        // Вызываем Gemini
        const analysisResult = await getGeminiAnalysis(geminiModel, dreamText); // <<<--- Вызываем обновленную функцию

        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("Could not delete status message:", e)); processingMessage = null; }

        // <<<--- ИЗМЕНЕНО: Проверяем, вернула ли функция getGeminiAnalysis СТРОКУ с сообщением об ошибке ---
        const isErrorResult = typeof analysisResult !== 'string' || // На всякий случай, если вернет не строку
                             ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));

        if (isErrorResult) {
            // Просто отправляем текст ошибки, который вернула getGeminiAnalysis
            await ctx.reply(analysisResult || "Произошла неизвестная ошибка анализа.").catch(logReplyError);
            console.warn(`Analysis for ${userId} failed or blocked, token consumed. Reason: ${analysisResult}`);
            return; // Прерываем выполнение, анализ не сохраняем
        }

        // Если дошли сюда, значит анализ успешен (analysisResult содержит текст анализа)
        const { error: insertError } = await supabase
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });

        if (insertError) {
            console.error(`Error saving analysis for user_id ${userDbId}:`, insertError);
            await ctx.reply("Сон проанализирован, но не удалось сохранить в историю. Вот результат:\n\n" + analysisResult).catch(logReplyError);
            // <<<--- ИЗМЕНЕНО: Добавим пояснение про токены и здесь ---
             await ctx.reply("Проверить оставшиеся токены можно в Личном кабинете.", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError);
            return;
        }

        console.log(`Analysis for ${userId} successful.`);
        // <<<--- ИЗМЕНЕНО: Улучшаем сообщение об успехе ---
        await ctx.reply(`Вот анализ вашего сна:\n\n${analysisResult}\n\nАнализ сохранен. Проверить оставшиеся токены можно в Личном кабинете.`, {
            reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
        }).catch(logReplyError);

    } catch (error) {
        console.error(`Critical error in analyzeDream for ${userId}:`, error);
         if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("Could not delete status message on error:", e)); }
        await ctx.reply("Произошла непредвиденная ошибка при обработке сна.").catch(logReplyError);
    }
}

function logReplyError(error) { console.error("Failed to send message to Telegram:", error); }


// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("Handler invoked.");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) { /*...*/ console.error("FATAL: Missing required environment variables!"); return { statusCode: 500, body: "Internal Server Error: Configuration missing." }; }
    if (!event.body) { /*...*/ console.warn("Handler called without event body."); return { statusCode: 400, body: "Bad Request: Missing event body" }; }
    let update; try { update = JSON.parse(event.body); } catch (e) { /*...*/ console.error("Failed to parse event body:", e); return { statusCode: 400, body: "Bad Request: Invalid JSON" }; }

    let supabase; let geminiModel; let bot;
    try {
        console.log("Initializing clients inside handler...");
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // <<<--- ИЗМЕНЕНО: Используем 'gemini-1.0-pro' ---
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
        console.log("Using Gemini model: gemini-1.0-pro"); // Логируем используемую модель
        bot = new Bot(BOT_TOKEN);
        console.log("Bot instance created. Calling bot.init()...");
        await bot.init();
        console.log("bot.init() successful. Bot info:", bot.botInfo);
    } catch (initError) {
        console.error("FATAL: Failed to initialize clients or bot.init() failed:", initError);
         // <<<--- ИЗМЕНЕНО: Проверяем ошибку инициализации Gemini ---
         if (initError.message && initError.message.includes("Fetching model")) {
              console.error("Specific error: Could not fetch the specified Gemini model. Check model name and API key permissions.");
              return { statusCode: 500, body: "Internal Server Error: Failed to configure AI model." };
         }
        return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." };
    }

    // Настройка обработчиков (без изменений)
    console.log("Setting up bot handlers...");
    bot.command("start", async (ctx) => {
        const userId = ctx.from?.id; if (!userId) return; console.log(`User ${userId} started bot.`);
        try {
            await getOrCreateUser(supabase, userId);
            await ctx.reply(
                "Добро пожаловать в Анализатор Снов! ✨\n\n" +
                "Опишите свой сон, и я помогу его растолковать (у вас 1 бесплатный анализ).\n\n" +
                "Личный кабинет для истории и токенов 👇", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError);
        } catch (e) { console.error("Error in /start handler:", e); await ctx.reply("Ошибка инициализации. Попробуйте /start еще раз.").catch(logReplyError); }
    });
    bot.on("message:text", async (ctx) => {
         const dreamText = ctx.message.text; const userId = ctx.from?.id; if (!userId) return;
         if (dreamText.startsWith('/')) { console.log(`Ignoring command: ${dreamText}`); return; }
         console.log(`Received text from ${userId}: "${dreamText.substring(0, 50)}..."`);
         await analyzeDream(ctx, supabase, geminiModel, dreamText); // Передаем geminiModel
    });
    bot.catch((err) => {
        const ctx = err.ctx; const e = err.error; console.error(`Error caught by bot.catch for update ${ctx.update.update_id}:`);
        if (e instanceof GrammyError) console.error("GrammyError:", e.description, e.payload);
        else if (e instanceof HttpError) console.error("HttpError:", e);
        else if (e instanceof Error) console.error("Error:", e.stack || e.message);
        else console.error("Unknown error object:", e);
    });
    console.log("Bot handlers configured.");

    // Обработка обновления (без изменений)
    try {
        console.log("Passing update to bot.handleUpdate...");
        await bot.handleUpdate(update);
        console.log("bot.handleUpdate finished.");
        return { statusCode: 200, body: "" };
    } catch (error) {
        console.error("Error during bot.handleUpdate call:", error);
        return { statusCode: 500, body: "Internal Server Error during update processing." };
    }
};

console.log("Netlify function bot.js (handler-init + bot.init() + gemini-2.0-flash) loaded.");
