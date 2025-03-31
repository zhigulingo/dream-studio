// bot/functions/bot.js

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError } = require("grammy"); // Добавлен Api
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto'); // Нужен для валидации в обработчике платежа

// --- Получение Переменных Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL; // URL для кнопок в сообщениях

// --- Вспомогательные Функции (без изменений) ---

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
            console.log(`[Bot] Created new user: tg_id=${userId}, id=${newUser.id}`);
            return newUser.id;
        }
    } catch (error) {
        console.error(`[Bot] Error in getOrCreateUser for ${userId}:`, error.message); return null;
    }
}

async function getGeminiAnalysis(geminiModel, dreamText) {
    if (!geminiModel) { console.error("[Bot] Gemini model is null or undefined in getGeminiAnalysis."); return "Ошибка: Сервис анализа не инициализирован."; }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;
    try {
        console.log("[Bot] Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        if (response.promptFeedback?.blockReason) { console.warn(`[Bot] Gemini blocked: ${response.promptFeedback.blockReason}`); return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}). Попробуйте переформулировать.`; }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) { console.error("[Bot] Gemini returned empty response."); return "К сожалению, не удалось получить анализ (пустой ответ от сервиса)."; }
        console.log("[Bot] Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("[Bot] Error explicitly caught in getGeminiAnalysis:", error);
         if (error.message && error.message.includes("API key not valid")) { return "Ошибка: Неверный ключ API для сервиса анализа."; }
         else if (error.status === 404 || (error.message && (error.message.includes("404") || error.message.includes("is not found")))) { console.error(`[Bot] Model not found error details: Status=${error.status}, Message=${error.message}`); return "Ошибка: Модель анализа не найдена или недоступна. Свяжитесь с поддержкой."; }
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
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("[Bot] Could not delete status message:", e)); processingMessage = null; }
        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) { await ctx.reply(analysisResult || "Произошла неизвестная ошибка анализа.").catch(logReplyError); console.warn(`[Bot] Analysis for ${userId} failed or blocked, token consumed. Reason: ${analysisResult}`); return; }
        const { error: insertError } = await supabase
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) { console.error(`[Bot] Error saving analysis for user_id ${userDbId}:`, insertError); await ctx.reply("Сон проанализирован, но не удалось сохранить в историю. Вот результат:\n\n" + analysisResult).catch(logReplyError); await ctx.reply("Проверить оставшиеся токены можно в Личном кабинете.", { reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined }).catch(logReplyError); return; }
        console.log(`[Bot] Analysis for ${userId} successful.`);
        await ctx.reply(`Вот анализ вашего сна:\n\n${analysisResult}\n\nАнализ сохранен. Проверить оставшиеся токены можно в Личном кабинете.`, {
            reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
        }).catch(logReplyError);
    } catch (error) {
        console.error(`[Bot] Critical error in analyzeDream for ${userId}:`, error);
         if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("[Bot] Could not delete status message on error:", e)); }
        await ctx.reply("Произошла непредвиденная ошибка при обработке сна.").catch(logReplyError);
    }
}

function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Bot] Handler invoked.");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) { console.error("[Bot] FATAL: Missing required environment variables!"); return { statusCode: 500, body: "Internal Server Error: Configuration missing." }; }
    if (!event.body) { console.warn("[Bot] Handler called without event body."); return { statusCode: 400, body: "Bad Request: Missing event body" }; }
    let update; try { update = JSON.parse(event.body); } catch (e) { console.error("[Bot] Failed to parse event body:", e); return { statusCode: 400, body: "Bad Request: Invalid JSON" }; }

    let supabase; let geminiModel; let bot;
    try {
        console.log("[Bot] Initializing clients inside handler...");
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const modelName = "gemini-2.0-flash"; // Используем правильное имя модели
        geminiModel = genAI.getGenerativeModel({ model: modelName });
        console.log(`[Bot] Using Gemini model: ${modelName}`);
        bot = new Bot(BOT_TOKEN);
        console.log("[Bot] Bot instance created. Calling bot.init()...");
        await bot.init();
        console.log("[Bot] bot.init() successful. Bot info:", bot.botInfo);
    } catch (initError) {
        console.error("[Bot] FATAL: Failed to initialize clients or bot.init() failed:", initError);
         if (initError.message && initError.message.includes("Fetching model")) { console.error("[Bot] Specific error: Could not fetch the specified Gemini model."); return { statusCode: 500, body: "Internal Server Error: Failed to configure AI model." }; }
         else if (initError.status === 404 || (initError.message && (initError.message.includes("404") || initError.message.includes("is not found")))) { console.error(`[Bot] Model not found during initialization: Status=${initError.status}, Message=${initError.message}`); return { statusCode: 500, body: "Internal Server Error: AI Model not found or inaccessible." }; }
        return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." };
    }

    // --- 3. Настройка обработчиков ---
    console.log("[Bot] Setting up bot handlers...");
    bot.command("start", async (ctx) => {
        const userId = ctx.from?.id; if (!userId) return; console.log(`[Bot] User ${userId} started bot.`);
        try {
            await getOrCreateUser(supabase, userId); // Используем supabase из scope хендлера
            await ctx.reply(
                "Добро пожаловать в Анализатор Снов! ✨\n\n" +
                "Опишите свой сон, и я помогу его растолковать (у вас 1 бесплатный анализ).\n\n" +
                "Личный кабинет для истории и токенов 👇", {
                reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть Личный кабинет 👤", web_app: { url: TMA_URL } }]] } : undefined
            }).catch(logReplyError);
        } catch (e) { console.error("[Bot] Error in /start handler:", e); await ctx.reply("Ошибка инициализации. Попробуйте /start еще раз.").catch(logReplyError); }
    });

    bot.on("message:text", async (ctx) => {
         const dreamText = ctx.message.text; const userId = ctx.from?.id; if (!userId) return;
         if (dreamText.startsWith('/')) { console.log(`[Bot] Ignoring command: ${dreamText}`); return; }
         console.log(`[Bot] Received text from ${userId}: "${dreamText.substring(0, 50)}..."`);
         await analyzeDream(ctx, supabase, geminiModel, dreamText); // Передаем supabase и geminiModel
    });

    // --- ДОБАВЛЕНЫ ОБРАБОТЧИКИ ПЛАТЕЖЕЙ ---
    bot.on('pre_checkout_query', async (ctx) => {
        const query = ctx.preCheckoutQuery;
        console.log(`[Bot] Received PreCheckoutQuery from ${query.from.id}, payload: ${query.invoice_payload}`);
        try {
            await ctx.answerPreCheckoutQuery(true); // Просто подтверждаем
            console.log("[Bot] PreCheckoutQuery answered successfully.");
        } catch (error) {
             console.error("[Bot] Failed to answer PreCheckoutQuery:", error);
             try { await ctx.answerPreCheckoutQuery(false, "Ошибка обработки запроса"); } catch (e) {}
        }
    });

    bot.on('message:successful_payment', async (ctx) => {
        const payment = ctx.message.successful_payment;
        const userId = ctx.from.id;
        console.log(`[Bot] Received SuccessfulPayment from ${userId}. Amount: ${payment.total_amount} ${payment.currency}. Payload: ${payment.invoice_payload}`);
        const payload = payment.invoice_payload;
        const parts = payload.split('_');

        if (parts.length < 4 || parts[0] !== 'sub') {
            console.error(`[Bot] Invalid payload received in SuccessfulPayment: ${payload}`);
            return;
        }
        const plan = parts[1];
        const durationMonths = parseInt(parts[2].replace('mo', ''), 10);
        const payloadUserId = parseInt(parts[3], 10);

        if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) {
             console.error(`[Bot] Payload parsing error or user mismatch: payload=${payload}, sender userId=${userId}`);
             return;
        }
        console.log(`[Bot] Processing payment for user ${userId}: Plan=${plan}, Duration=${durationMonths} months.`);

        try {
            if (!supabase) { console.error("[Bot] Supabase client not available in successful_payment handler!"); throw new Error("Database client unavailable"); }
            const { data: user, error: findError } = await supabase
                .from('users').select('id, subscription_end').eq('tg_id', userId).single();
            if (findError || !user) { console.error(`[Bot] User ${userId} not found in DB for successful payment! Error: ${findError?.message}`); await ctx.reply("Спасибо за оплату! Ошибка при поиске профиля. Свяжитесь с поддержкой.").catch(logReplyError); return; }

            const now = new Date();
            let currentSubEnd = user.subscription_end ? new Date(user.subscription_end) : now;
            if (currentSubEnd < now) { currentSubEnd = now; }
            const newSubEndDate = new Date(currentSubEnd.setMonth(currentSubEnd.getMonth() + durationMonths));

             const { error: updateError } = await supabase
                 .from('users')
                 .update({
                     subscription_type: plan,
                     subscription_end: newSubEndDate.toISOString(),
                 })
                 .eq('id', user.id);
            if (updateError) { console.error(`[Bot] Failed to update user ${userId} subscription in DB:`, updateError); throw new Error("Database update failed"); }

            console.log(`[Bot] User ${userId} subscription updated: Plan=${plan}, Ends=${newSubEndDate.toISOString()}`);
            await ctx.reply(`Спасибо за оплату! Ваша подписка "${plan.toUpperCase()}" активна до ${newSubEndDate.toLocaleDateString()}.`).catch(logReplyError);

        } catch (error) {
             console.error(`[Bot] Failed to process successful payment for user ${userId}:`, error);
             await ctx.reply("Ваш платеж получен, но произошла ошибка при обновлении подписки. Свяжитесь с поддержкой.").catch(logReplyError);
        }
    });
    // --- КОНЕЦ ОБРАБОТЧИКОВ ПЛАТЕЖЕЙ ---

    bot.catch((err) => {
        const ctx = err.ctx; const e = err.error; console.error(`[Bot] Error caught by bot.catch for update ${ctx.update.update_id}:`);
        if (e instanceof GrammyError) console.error("GrammyError:", e.description, e.payload);
        else if (e instanceof HttpError) console.error("HttpError:", e);
        else if (e instanceof Error) console.error("Error:", e.stack || e.message);
        else console.error("Unknown error object:", e);
    });
    console.log("[Bot] Bot handlers configured (including payment handlers).");

    // --- 4. Обработка обновления ---
    try {
        console.log("[Bot] Passing update to bot.handleUpdate...");
        await bot.handleUpdate(update); // Используем await
        console.log("[Bot] bot.handleUpdate finished.");
        return { statusCode: 200, body: "" };
    } catch (error) {
        console.error("[Bot] Error during bot.handleUpdate call:", error);
        return { statusCode: 500, body: "Internal Server Error during update processing." };
    }
};

console.log("[Bot] Netlify function bot.js (with payment handlers) loaded.");
