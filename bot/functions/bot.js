// bot/functions/bot.js (Попытка №10: Исправлен getOrCreateUser и analyzeDream/Gemini)

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError, webhookCallback } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Переменные Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Глобальная Инициализация ---
let bot;
let supabaseAdmin;
let genAI; // Только инстанс GoogleGenerativeAI
let geminiModel = null; // Сам model будет инициализироваться по требованию
let initializationError = null;
let botInitializedAndHandlersSet = false;

try {
    console.log("[Bot Global Init] Starting initialization...");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        throw new Error("FATAL: Missing one or more environment variables!");
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY); // Создаем главный объект Google AI
    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Clients and bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    // Обработчик /start
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received.");
        const userId = ctx.from?.id; const chatId = ctx.chat.id;
        if (!userId || !chatId) { console.warn("[Bot Handler /start] No user ID or chat ID."); return; }
        console.log(`[Bot Handler /start] User ${userId} in chat ${chatId}`);
        try {
            // <<<--- ВАЖНО: Ловим ошибки именно от getOrCreateUser ---
            const userData = await getOrCreateUser(supabaseAdmin, userId);
            console.log(`[Bot Handler /start] User data received: ID=${userData.id}, Claimed=${userData.claimed}, LastMsgId=${userData.lastMessageId}`);
            // <<<--- КОНЕЦ ВАЖНОГО ---

            // Удаление предыдущего сообщения
            if (userData.lastMessageId) { /* ... (логика удаления без изменений) ... */ }
            // Определение текста и кнопки
            let messageText, buttonText, buttonUrl;
            if (userData.claimed) { messageText = "С возвращением! 👋 Анализируй сны или загляни в ЛК."; buttonText = "Личный кабинет"; buttonUrl = TMA_URL; }
            else { messageText = "Привет! 👋 Бот для анализа снов.\n\nНажми кнопку, чтобы получить <b>первый бесплатный токен</b> за подписку!"; buttonText = "🎁 Открыть и получить токен"; buttonUrl = `${TMA_URL}?action=claim_reward`; }
            // Отправка нового сообщения
            console.log(`[Bot Handler /start] Sending new message (Claimed: ${userData.claimed})`);
            const sentMessage = await ctx.reply(messageText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: buttonUrl } }]] } });
            console.log(`[Bot Handler /start] New message sent. ID: ${sentMessage.message_id}`);
            // Сохранение ID нового сообщения
            const { error: updateError } = await supabaseAdmin.from('users').update({ last_start_message_id: sentMessage.message_id }).eq('id', userData.id);
            if (updateError) console.error(`[Bot Handler /start] Failed update last_start_message_id:`, updateError);
            else console.log(`[Bot Handler /start] Updated last_start_message_id to ${sentMessage.message_id}.`);
        } catch (e) { // <<<--- Ловим ошибку, проброшенную из getOrCreateUser ---
             console.error("[Bot Handler /start] CRITICAL Error (likely from getOrCreateUser):", e.message); // Логируем КОНКРЕТНУЮ ошибку
             try { await ctx.reply(`Произошла ошибка при получении данных пользователя (${e.message}). Попробуйте позже.`).catch(logReplyError); } catch {}
        }
    });

    // Обработчик текстовых сообщений (ПЕРЕДАЕМ geminiModel)
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler text] Received text message.");
        const dreamText = ctx.message.text; const userId = ctx.from?.id; const chatId = ctx.chat.id; const messageId = ctx.message.message_id;
        if (!userId || !chatId) { console.warn("[Bot Handler text] No user/chat ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler text] Ignoring command.`); return; }
        console.log(`[Bot Handler text] Processing dream for ${userId}`);
        let statusMessage;
        try {
            console.log(`[Bot Handler text] Deleting user message ${messageId}`);
            await ctx.api.deleteMessage(chatId, messageId).catch(delErr => { /* ... обработка ошибок удаления ... */});
            statusMessage = await ctx.reply("Анализирую ваш сон... 🧠✨").catch(logReplyError);
            if (!statusMessage) throw new Error("Failed to send status message.");
            // <<<--- ИСПРАВЛЕНИЕ: ПЕРЕДАЕМ geminiModel в analyzeDream ---
            await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText); // Передаем текущий (возможно null) geminiModel
            // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ---
            console.log(`[Bot Handler text] Deleting status message ${statusMessage.message_id}`);
            await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(delErr => { console.warn(`[Bot Handler text] Failed delete status msg ${statusMessage.message_id}:`, delErr); });
            console.log(`[Bot Handler text] Analysis complete. Sending confirmation.`);
            await ctx.reply("Ваш анализ сна готов и сохранен! ✨\n\nПосмотрите его в истории в ЛК.", { reply_markup: { inline_keyboard: [[{ text: "Открыть Личный кабинет", web_app: { url: TMA_URL } }]] } }).catch(logReplyError);
        } catch (error) { // Ловим ошибки из analyzeDream
            console.error(`[Bot Handler text] Error processing dream for ${userId}:`, error); // Логируем КОНКРЕТНУЮ ошибку
            if (statusMessage) { await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(e => {}); }
            await ctx.reply(`Произошла ошибка: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError); // Показываем ошибку пользователю
        }
    });

    // Другие обработчики (без изменений)
    bot.on('pre_checkout_query', async (ctx) => { /* ... */ });
    bot.on('message:successful_payment', async (ctx) => { /* ... */ });
    bot.catch((err) => { /* ... */ });

    console.log("[Bot Global Init] Handlers setup complete.");
    botInitializedAndHandlersSet = true;

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error;
    bot = null;
    botInitializedAndHandlersSet = false;
}

// --- Вспомогательные Функции ---

// getOrCreateUser (Исправлен catch и добавлено логирование внутри try)
async function getOrCreateUser(supabase, userId) {
    if (!supabase) { throw new Error("Supabase client not provided to getOrCreateUser."); } // Более четкая ошибка
    console.log(`[getOrCreateUser] Processing user ${userId}...`);
    try {
        console.log(`[getOrCreateUser] Selecting user ${userId}...`);
        let { data: existingUser, error: selectError } = await supabase
            .from('users').select('id, channel_reward_claimed, last_start_message_id').eq('tg_id', userId).single();

        if (selectError && selectError.code !== 'PGRST116') {
             console.error(`[getOrCreateUser] Supabase SELECT error: ${selectError.message}`);
             throw new Error(`DB Select Error: ${selectError.message}`); // Пробрасываем ошибку
        }
        if (existingUser) {
            console.log(`[getOrCreateUser] Found existing user ${userId}.`);
            return { id: existingUser.id, claimed: existingUser.channel_reward_claimed ?? false, lastMessageId: existingUser.last_start_message_id };
        } else {
            console.log(`[getOrCreateUser] User ${userId} not found. Creating...`);
            const { data: newUser, error: insertError } = await supabase
                .from('users').insert({ tg_id: userId, subscription_type: 'free', tokens: 0, channel_reward_claimed: false }).select('id').single();

            if (insertError) {
                 console.error(`[getOrCreateUser] Supabase INSERT error: ${insertError.message}`);
                 if (insertError.code === '23505') { // Race condition
                     console.warn(`[getOrCreateUser] Race condition for ${userId}. Re-fetching...`);
                     let { data: raceUser, error: raceError } = await supabase.from('users').select('id, channel_reward_claimed, last_start_message_id').eq('tg_id', userId).single();
                     if (raceError) { throw new Error(`DB Re-fetch Error: ${raceError.message}`); } // Ошибка при повторном поиске
                     if (raceUser) { console.log(`[getOrCreateUser] Found user ${userId} on re-fetch.`); return { id: raceUser.id, claimed: raceUser.channel_reward_claimed ?? false, lastMessageId: raceUser.last_start_message_id }; }
                     else { throw new Error("DB Inconsistent state after unique violation."); } // Странная ситуация
                 }
                 throw new Error(`DB Insert Error: ${insertError.message}`); // Другая ошибка вставки
            }
            if (!newUser) { throw new Error("DB Insert Error: No data returned after user creation."); } // Ошибка, если нет ID
            console.log(`[getOrCreateUser] Created new user ${userId} with ID ${newUser.id}.`);
            return { id: newUser.id, claimed: false, lastMessageId: null };
        }
    } catch (error) {
        // Логируем ошибку, которая произошла ВНУТРИ try блока или была проброшена
        console.error(`[getOrCreateUser] FAILED for user ${userId}:`, error);
        // Пробрасываем ошибку дальше, чтобы ее поймал catch в /start
        throw error; // <<<--- Убеждаемся, что любая ошибка пробрасывается
    }
}


// getGeminiAnalysis (Принимает модель, инициализирует при необходимости)
async function getGeminiAnalysis(passedModel, dreamText) {
     console.log("[getGeminiAnalysis] Function called.");
     let modelToUse = passedModel; // Используем переданную модель по умолчанию

     // Если модель не передана или не инициализирована глобально, пытаемся создать
     if (!modelToUse) {
         console.log("[getGeminiAnalysis] Model not passed or null, attempting initialization...");
         try {
             if (!genAI) { throw new Error("GoogleGenerativeAI instance (genAI) is not available."); }
             modelToUse = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
             // Сохраняем в глобальную переменную для следующих вызовов ЭТОГО ЖЕ инстанса функции
             // (но не полагаемся на это между разными вызовами Netlify функции)
             geminiModel = modelToUse;
             console.log("[getGeminiAnalysis] Gemini model initialized successfully within function.");
         } catch (initErr) {
             console.error("[getGeminiAnalysis] Failed to initialize Gemini model:", initErr);
             throw new Error(`Не удалось инициализировать сервис анализа: ${initErr.message}`); // Выбрасываем ошибку
         }
     } else {
          console.log("[getGeminiAnalysis] Using pre-initialized/passed model.");
     }

     // Проверка текста сна
     const MAX_DREAM_LENGTH = 4000;
     if (!dreamText || dreamText.trim().length === 0) { throw new Error("Пустой текст сна."); }
     if (dreamText.length > MAX_DREAM_LENGTH) { throw new Error(`Сон слишком длинный (>${MAX_DREAM_LENGTH} симв.).`); }

     // Вызов API Gemini
     try {
         console.log("[getGeminiAnalysis] Requesting Gemini analysis...");
         const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
         const result = await modelToUse.generateContent(prompt); // Используем modelToUse
         const response = await result.response;

         if (response.promptFeedback?.blockReason) {
             console.warn(`[getGeminiAnalysis] Gemini blocked: ${response.promptFeedback.blockReason}`);
             throw new Error(`Анализ заблокирован (${response.promptFeedback.blockReason}).`); // Выбрасываем ошибку
         }
         const analysisText = response.text();
         if (!analysisText || analysisText.trim().length === 0) {
             console.error("[getGeminiAnalysis] Gemini returned empty response.");
             throw new Error("Пустой ответ от сервиса анализа."); // Выбрасываем ошибку
         }
         console.log("[getGeminiAnalysis] Gemini analysis received successfully.");
         return analysisText; // Возвращаем ТЕКСТ анализа при успехе
     } catch (error) {
         console.error("[getGeminiAnalysis] Error during Gemini API call:", error);
         // Формируем сообщение об ошибке и выбрасываем его
         if (error.message?.includes("API key not valid")) throw new Error("Неверный ключ API Gemini.");
         else if (error.status === 404 || error.message?.includes("404") || error.message?.includes("is not found")) throw new Error("Модель Gemini не найдена.");
         else if (error.message?.includes("quota")) throw new Error("Превышена квота Gemini API.");
         // Общая ошибка API
         throw new Error(`Ошибка связи с сервисом анализа (${error.message})`);
     }
}


// analyzeDream (Принимает модель, передает ее дальше, ловит ошибки)
async function analyzeDream(ctx, supabase, passedGeminiModel, dreamText) {
    console.log("[analyzeDream] Function called."); // Лог входа
    const userId = ctx.from?.id;
    if (!userId) { throw new Error("Не удалось идентифицировать пользователя."); }

    try {
        // 1. Получаем ID пользователя в нашей БД
        console.log(`[analyzeDream] Getting user DB ID for ${userId}...`);
        const userData = await getOrCreateUser(supabase, userId);
        const userDbId = userData.id;
        if (!userDbId) { throw new Error("Ошибка доступа к профилю пользователя."); }
        console.log(`[analyzeDream] User DB ID: ${userDbId}`);

        // 2. Проверяем и списываем токен
        console.log(`[analyzeDream] Checking/decrementing token for ${userId}...`);
        const { data: tokenDecremented, error: rpcError } = await supabase
            .rpc('decrement_token_if_available', { user_tg_id: userId });
        if (rpcError) { throw new Error(`Внутренняя ошибка токенов: ${rpcError.message}`); }
        if (!tokenDecremented) { throw new Error("Недостаточно токенов для анализа."); }
        console.log(`[analyzeDream] Token decremented for user ${userId}.`);

        // 3. Получаем анализ от Gemini (передаем модель, ловим ошибки)
        console.log(`[analyzeDream] Requesting analysis...`);
        // <<<--- ИСПРАВЛЕНИЕ: Передаем passedGeminiModel ---
        const analysisResultText = await getGeminiAnalysis(passedGeminiModel, dreamText);
        // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ---
        console.log(`[analyzeDream] Analysis received successfully.`); // Лог успеха

        // 4. Сохраняем результат в базу
        console.log(`[analyzeDream] Saving analysis to DB for user ${userDbId}...`);
        const { error: insertError } = await supabase
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResultText });
        if (insertError) { throw new Error(`Ошибка сохранения анализа: ${insertError.message}`); }
        console.log(`[analyzeDream] Analysis saved successfully.`);

        return; // Успешное завершение

    } catch (error) {
        // Ловим все ошибки из блока try и пробрасываем их
        console.error(`[analyzeDream] FAILED for user ${userId}: ${error.message}`);
        throw error; // Пробрасываем для обработчика 'message:text'
    }
}

// logReplyError (без изменений)
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }


// --- Экспорт обработчика для Netlify с webhookCallback ---
// (Код без изменений по сравнению с Попыткой #9)
let netlifyWebhookHandler = null;
if (botInitializedAndHandlersSet && bot) {
    try {
        netlifyWebhookHandler = webhookCallback(bot, 'aws-lambda-async');
        console.log("[Bot Global Init] webhookCallback created successfully.");
    } catch (callbackError) { console.error("[Bot Global Init] FAILED TO CREATE webhookCallback:", callbackError); initializationError = callbackError; }
} else { console.error("[Bot Global Init] Skipping webhookCallback creation due to errors."); }

exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");
    if (initializationError || !netlifyWebhookHandler) { console.error("[Netlify Handler] Initialization/webhookCallback failed.", initializationError); return { statusCode: 500, body: "Internal Server Error: Bot failed to initialize." }; }
    console.log("[Netlify Handler] Calling pre-created webhookCallback handler...");
    return netlifyWebhookHandler(event);
};

console.log("[Bot Global Init] Netlify handler exported.");
