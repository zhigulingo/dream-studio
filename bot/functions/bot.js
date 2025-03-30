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

// --- Вспомогательные Функции (без изменений) ---
// ... (getOrCreateUser, getGeminiAnalysis, analyzeDream, logReplyError) ...
// Код этих функций остается точно таким же, как в предыдущем ответе.
// Я их сократил здесь для краткости, но в вашем файле они должны быть полностью.

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
    if (!geminiModel) {
         console.error("Gemini model is null or undefined in getGeminiAnalysis.");
         return "Ошибка: Сервис анализа не инициализирован.";
    }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;

    try {
        console.log("Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;

        if (response.promptFeedback?.blockReason) {
            console.warn(`Gemini blocked: ${response.promptFeedback.blockReason}`);
            return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}). Попробуйте переформулировать.`;
        }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) {
            console.error("Gemini returned empty response.");
            if (!response.candidates || response.candidates.length === 0) { console.error("Gemini response candidates array is empty or missing."); }
            else { console.log("Gemini response candidates:", JSON.stringify(response.candidates)); }
            return "К сожалению, не удалось получить анализ (пустой ответ от сервиса).";
        }
        console.log("Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("Error explicitly caught in getGeminiAnalysis:", error);
         if (error.message && error.message.includes("API key not valid")) { return "Ошибка: Неверный ключ API для сервиса анализа."; }
         // <<<--- Уточним проверку на 404 ---
         else if (error.status === 404 || (error.message && (error.message.includes("404") || error.message.includes("is not found")))) {
             console.error(`Model not found error details: Status=${error.status}, Message=${error.message}`);
             return "Ошибка: Модель анализа не найдена или недоступна. Свяжитесь с поддержкой.";
         }
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
        const analysisResult = await getGeminiAnalysis(geminiModel, dreamText);
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("Could not delete status message:", e)); processingMessage = null; }
        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) {
            await ctx.reply(analysisResult || "Произошла неизвестная ошибка анализа.").catch(logReplyError);
            console.warn(`Analysis for ${userId} failed or blocked, token consumed. Reason: ${analysisResult}`); return;
        }
        const { error: insertError } = await supabase
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) {
            console.error(`Error saving analysis for user_id ${userDbId}:`, insertError);
            await ctx.reply("Сон проанализирован, но не удалось сохранить в историю. Вот результат:\n\n" + analysisResult).catch(logReplyError);
             await ctx.reply("Проверить оставшиеся токены можно в Личном кабинете.", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError); return;
        }
        console.log(`Analysis for ${userId} successful.`);
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
        // <<<--- ИЗМЕНЕНО: Используем 'gemini-2.0-flash' ---
        geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        console.log("Using Gemini model: gemini-2.0-flash"); // Логируем правильную модель
        bot = new Bot(BOT_TOKEN);
        console.log("Bot instance created. Calling bot.init()...");
        await bot.init();
        console.log("bot.init() successful. Bot info:", bot.botInfo);
    } catch (initError) {
        console.error("FATAL: Failed to initialize clients or bot.init() failed:", initError);
         if (initError.message && initError.message.includes("Fetching model")) { console.error("Specific error: Could not fetch the specified Gemini model. Check model name and API key permissions."); return { statusCode: 500, body: "Internal Server Error: Failed to configure AI model." }; }
         // <<<--- Добавим проверку на ошибку доступа к модели ---
         else if (initError.status === 404 || (initError.message && (initError.message.includes("404") || initError.message.includes("is not found")))) {
             console.error(`Model not found during initialization: Status=${initError.status}, Message=${initError.message}`);
             return { statusCode: 500, body: "Internal Server Error: AI Model not found or inaccessible." };
         }
        return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." };
    }

    // Настройка обработчиков
    console.log("Setting up bot handlers...");
    bot.command("start", async (ctx) => { /* ... код без изменений ... */
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
    bot.on("message:text", async (ctx) => { /* ... код без изменений ... */
         const dreamText = ctx.message.text; const userId = ctx.from?.id; if (!userId) return;
         if (dreamText.startsWith('/')) { console.log(`Ignoring command: ${dreamText}`); return; }
         console.log(`Received text from ${userId}: "${dreamText.substring(0, 50)}..."`);
         await analyzeDream(ctx, supabase, geminiModel, dreamText); // Передаем geminiModel
    });
    // <<<--- ДОБАВЛЕНО: Обработчик SuccessfulPayment ---
    bot.on('message:successful_payment', async (ctx) => {
        const payment = ctx.message.successful_payment;
        const userId = ctx.from.id; // ID пользователя, который платил
        console.log(`Received SuccessfulPayment from ${userId}:`, payment);

        // Распарсим payload, который мы создали в TMA
        const payload = payment.invoice_payload; // Например: "sub_premium_3mo_638922962"
        const parts = payload.split('_');
        if (parts.length < 4 || parts[0] !== 'sub') {
            console.error(`Invalid payload received: ${payload}`);
            // Что делать в этом случае? Можно ничего не делать или уведомить админа.
            return;
        }

        const plan = parts[1]; // 'premium' или 'basic'
        const durationMonths = parseInt(parts[2].replace('mo', ''), 10);
        const payloadUserId = parseInt(parts[3], 10); // ID из payload (для доп. проверки)

        if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) {
             console.error(`Payload parsing error or user mismatch: payload=${payload}, userId=${userId}`);
             // Можно уведомить пользователя об ошибке
             // await ctx.reply("Произошла ошибка при обработке вашего платежа. Свяжитесь с поддержкой.").catch(logReplyError);
             return;
        }

        console.log(`Processing payment for user ${userId}: Plan=${plan}, Duration=${durationMonths} months.`);

        // Обновляем данные пользователя в Supabase
        try {
            if (!supabase) { // Убедимся, что клиент supabase доступен
                 console.error("Supabase client not available in successful_payment handler!");
                 throw new Error("Database client unavailable");
            }

             // Найти пользователя по tg_id
            const { data: user, error: findError } = await supabase
                .from('users').select('id, subscription_end').eq('tg_id', userId).single();

            if (findError || !user) {
                console.error(`User ${userId} not found in DB for successful payment!`);
                throw new Error(`User ${userId} not found`);
            }

            // Рассчитать новую дату окончания подписки
            const now = new Date();
            let currentSubEnd = user.subscription_end ? new Date(user.subscription_end) : now;
            // Если текущая подписка уже истекла, начинаем отсчет с "сейчас"
            if (currentSubEnd < now) {
                 currentSubEnd = now;
            }
            // Добавляем месяцы
            const newSubEndDate = new Date(currentSubEnd.setMonth(currentSubEnd.getMonth() + durationMonths));

            // Обновляем запись пользователя
             const { error: updateError } = await supabase
                 .from('users')
                 .update({
                     subscription_type: plan,
                     subscription_end: newSubEndDate.toISOString(),
                     // Можно добавить токены, если тариф basic их дает
                     // tokens: (plan === 'basic' ? 30 : supabase.literal('tokens')) // Пример: basic дает 30 токенов, premium не меняет
                 })
                 .eq('id', user.id); // Обновляем по внутреннему ID

            if (updateError) {
                console.error(`Failed to update user ${userId} subscription in DB:`, updateError);
                throw new Error("Database update failed");
            }

            console.log(`User ${userId} subscription updated: Plan=${plan}, Ends=${newSubEndDate.toISOString()}`);

            // Отправляем пользователю сообщение об успехе
            await ctx.reply(`Спасибо за оплату! Ваша подписка "${plan.toUpperCase()}" активна до ${newSubEndDate.toLocaleDateString()}. Приятного анализа снов!`).catch(logReplyError);

        } catch (error) {
             console.error(`Failed to process successful payment for user ${userId}:`, error);
             // Уведомляем пользователя об ошибке обработки
             await ctx.reply("Ваш платеж получен, но произошла ошибка при обновлении подписки. Пожалуйста, свяжитесь с поддержкой, указав детали платежа.").catch(logReplyError);
        }
    });

    bot.catch((err) => { /* ... код без изменений ... */
        const ctx = err.ctx; const e = err.error; console.error(`Error caught by bot.catch for update ${ctx.update.update_id}:`);
        if (e instanceof GrammyError) console.error("GrammyError:", e.description, e.payload);
        else if (e instanceof HttpError) console.error("HttpError:", e);
        else if (e instanceof Error) console.error("Error:", e.stack || e.message);
        else console.error("Unknown error object:", e);
    });
    console.log("Bot handlers configured.");

    // Обработка обновления
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

// <<<--- ИЗМЕНЕНО: Обновляем лог загрузки ---
console.log("Netlify function bot.js (handler-init + bot.init() + gemini-2.0-flash) loaded.");
