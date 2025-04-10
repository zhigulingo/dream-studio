// bot/functions/bot.js (Попытка №6: Возврат к простой структуре с await bot.init())

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError } = require("grammy"); // Убрали webhookCallback
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Получение Переменных Окружения ---
// (Убедитесь, что они существуют и верны в Netlify)
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Вспомогательные Функции ---
// getOrCreateUser, getGeminiAnalysis, analyzeDream, logReplyError
// (Их код должен быть здесь, как в предыдущих версиях)
async function getOrCreateUser(supabase, userId) {
    // ... (код функции с tokens: 0) ...
     if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
     try {
         let { data: existingUser, error: selectError } = await supabase.from('users').select('id, tokens').eq('tg_id', userId).single();
         if (selectError && selectError.code !== 'PGRST116') { console.error(`[Bot:getOrCreateUser] Error selecting user ${userId}:`, selectError); throw selectError; }
         if (existingUser) { console.log(`[Bot:getOrCreateUser] Existing user found: tg_id=${userId}, id=${existingUser.id}, tokens=${existingUser.tokens}`); return existingUser.id; }
         else {
             console.log(`[Bot:getOrCreateUser] User ${userId} not found. Creating...`);
             const { data: newUser, error: insertError } = await supabase.from('users').insert({ tg_id: userId, subscription_type: 'free', tokens: 0, channel_reward_claimed: false }).select('id').single();
             if (insertError) {
                 console.error(`[Bot:getOrCreateUser] Error inserting new user ${userId}:`, insertError);
                 if (insertError.code === '23505') { console.warn(`[Bot:getOrCreateUser] Race condition likely for user ${userId}. Trying to fetch again.`); let { data: raceUser, error: raceError } = await supabase.from('users').select('id').eq('tg_id', userId).single(); if (raceError) throw raceError; if (raceUser) return raceUser.id; }
                 throw insertError;
             }
             if (!newUser) { throw new Error("User creation successful but returned no data."); }
             console.log(`[Bot:getOrCreateUser] Created new user: tg_id=${userId}, id=${newUser.id}, initial tokens=0`);
             return newUser.id;
         }
     } catch (error) { console.error(`[Bot:getOrCreateUser] Critical error for user ${userId}:`, error.message); return null; }
}
async function getGeminiAnalysis(geminiModel, dreamText) {
    // ... (код функции без изменений) ...
    if (!geminiModel) { console.error("[Bot] Gemini model is null or undefined in getGeminiAnalysis."); return "Ошибка: Сервис анализа не инициализирован."; }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;
    try {
        console.log("[Bot] Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        if (response.promptFeedback?.blockReason) { console.warn(`[Bot] Gemini blocked: ${response.promptFeedback.blockReason}`); return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}).`; }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) { console.error("[Bot] Gemini returned empty response."); return "К сожалению, не удалось получить анализ (пустой ответ)."; }
        console.log("[Bot] Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("[Bot] Error explicitly caught in getGeminiAnalysis:", error);
         if (error.message?.includes("API key not valid")) { return "Ошибка: Неверный ключ API."; }
         else if (error.status === 404 || error.message?.includes("404") || error.message?.includes("is not found")) { return "Ошибка: Модель анализа не найдена."; }
        return "Ошибка при связи с сервисом анализа.";
    }
}
async function analyzeDream(ctx, supabase, geminiModel, dreamText) {
    // ... (код функции без изменений) ...
    const userId = ctx.from?.id;
    if (!userId) { await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError); return; }
    let userDbId; let processingMessage;
    try {
        userDbId = await getOrCreateUser(supabase, userId);
        if (!userDbId) { await ctx.reply("Ошибка доступа к профилю.").catch(logReplyError); return; }
        processingMessage = await ctx.reply("Проверяем токены...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabase.rpc('decrement_token_if_available', { user_tg_id: userId });
        if (rpcError) { console.error(`[Bot:analyzeDream] RPC error for tg_id ${userId}:`, rpcError); throw new Error("Внутренняя ошибка токенов.");}
        if (!tokenDecremented) {
             console.log(`[Bot:analyzeDream] Not enough tokens for ${userId}.`);
             if (processingMessage) await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {});
             const noTokensMessage = "Закончились токены для анализа 😟\n\nВы можете получить один бесплатный токен за подписку на канал или приобрести подписку.";
             const buttons = [];
             if (TMA_URL) { buttons.push([{ text: "🎁 Получить бесплатный токен", web_app: { url: `${TMA_URL}?action=claim_reward` } }]); }
             if (TMA_URL) { buttons.push([{ text: "🛒 Приобрести подписку", web_app: { url: TMA_URL } }]); }
             await ctx.reply(noTokensMessage, { reply_markup: { inline_keyboard: buttons } }).catch(logReplyError);
             return;
        }
        console.log(`[Bot:analyzeDream] Token decremented for ${userId}.`);
        if (processingMessage) { await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую... 🧠✨").catch(logReplyError); }
        else { await ctx.reply("Токен использован. Анализирую... 🧠✨").catch(logReplyError); }
        const analysisResult = await getGeminiAnalysis(geminiModel, dreamText);
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); processingMessage = null; }
        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) { await ctx.reply(analysisResult || "Неизвестная ошибка анализа.").catch(logReplyError); console.warn(`[Bot] Analysis failed for ${userId}, token consumed.`); return; }
        const { error: insertError } = await supabase.from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) { console.error(`[Bot] Error saving analysis for ${userDbId}:`, insertError); await ctx.reply("Анализ готов, но ошибка сохранения:\n\n" + analysisResult).catch(logReplyError); return; }
        console.log(`[Bot] Analysis successful for ${userId}.`);
        await ctx.reply(`Анализ сна:\n\n${analysisResult}\n\nТокен списан. История в ЛК.`, { reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть ЛК", web_app: { url: TMA_URL } }]] } : undefined }).catch(logReplyError);
    } catch (error) {
        console.error(`[Bot] Critical error in analyzeDream for ${userId}:`, error.message);
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); }
        await ctx.reply(`Ошибка обработки: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
    }
}
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }


// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked."); // Лог вызова

    // --- Проверка переменных окружения ---
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        console.error("[Netlify Handler] FATAL: Missing environment variables!");
        return { statusCode: 500, body: "Configuration missing." };
    }

    // --- Парсинг тела запроса ---
    let update;
    try {
        if (!event.body) { console.warn("[Netlify Handler] Empty event body."); return { statusCode: 400, body: "Bad Request: Empty body" }; }
        update = JSON.parse(event.body);
        console.log(`[Netlify Handler] Parsed update ID: ${update.update_id}`);
    } catch (e) {
        console.error("[Netlify Handler] Invalid JSON body:", e);
        return { statusCode: 400, body: "Invalid JSON body" };
    }

    let bot;
    let supabaseAdmin;
    let geminiModel;

    try {
        // --- Инициализация клиентов ВНУТРИ хендлера ---
        console.log("[Netlify Handler] Initializing clients...");
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        bot = new Bot(BOT_TOKEN);
        console.log("[Netlify Handler] Basic bot instance created.");

        // --- Инициализация бота (ВАЖНО!) ---
        console.log("[Netlify Handler] Initializing bot (calling bot.init)...");
        await bot.init(); // <<<--- ВЫЗЫВАЕМ bot.init() ЗДЕСЬ
        console.log("[Netlify Handler] Bot initialized successfully.");

        // --- Настройка обработчиков ---
        console.log("[Netlify Handler] Setting up handlers...");

        bot.command("start", async (ctx) => {
            console.log("[Bot Handler /start] Command received.");
            const userId = ctx.from?.id;
            if (!userId) { console.warn("[Bot Handler /start] No user ID."); return; }
            console.log(`[Bot Handler /start] User ${userId}`);
            try {
                await getOrCreateUser(supabaseAdmin, userId); // Используем локальный supabaseAdmin
                console.log(`[Bot Handler /start] Ensured user ${userId} exists.`);
                const welcomeMessage = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой <b>первый бесплатный токен</b> за подписку на канал!";
                const buttonUrl = `${TMA_URL}?action=claim_reward`;
                await ctx.reply(welcomeMessage, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "🎁 Открыть приложение и получить токен", web_app: { url: buttonUrl } }]] } }).catch(logReplyError);
                console.log(`[Bot Handler /start] Welcome message sent to ${userId}.`);
            } catch (e) { console.error("[Bot Handler /start] Error:", e); await ctx.reply("Ошибка при обработке /start.").catch(logReplyError); }
        });

        bot.on("message:text", async (ctx) => {
            console.log("[Bot Handler message:text] Text received.");
            const dreamText = ctx.message.text;
            const userId = ctx.from?.id;
            if (!userId) { console.warn("[Bot Handler message:text] No user ID."); return; }
            if (dreamText.startsWith('/')) { console.log(`[Bot Handler message:text] Ignoring command.`); return; }
            console.log(`[Bot Handler message:text] Processing dream for ${userId}`);
            await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText); // Используем локальные клиенты
        });

        bot.on('pre_checkout_query', async (ctx) => { /* ... */ });
        bot.on('message:successful_payment', async (ctx) => { /* ... (использует локальный supabaseAdmin) ... */ });
        bot.catch((err) => { /* ... */ });

        console.log("[Netlify Handler] Handlers configured.");

        // --- Обработка обновления ---
        console.log(`[Netlify Handler] Processing update ${update.update_id} with bot.handleUpdate...`);
        await bot.handleUpdate(update);
        console.log(`[Netlify Handler] bot.handleUpdate finished for update ${update.update_id}.`);

        // Возвращаем успешный ответ Telegram
        return { statusCode: 200, body: "" };

    } catch (error) {
        // Ловим ошибки инициализации или КРИТИЧЕСКИЕ ошибки handleUpdate
        console.error(`[Netlify Handler] UNEXPECTED error during handler execution for update ${update?.update_id}:`, error);
        // Не отвечаем пользователю напрямую из catch, чтобы избежать зацикливания ошибок
        return {
            statusCode: error instanceof GrammyError && error.error_code === 401 ? 401 : 500, // Возвращаем 401, если токен невалиден
            body: "Internal Server Error processing update."
        };
    }
};
