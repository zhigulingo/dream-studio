// bot/functions/bot.js (Попытка №9: Снова webhookCallback, исправленный /start)

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
let genAI; // Объявляем здесь
let geminiModel = null; // Инициализируем как null
let initializationError = null;
let botInitializedAndHandlersSet = false; // Флаг успешной настройки

try {
    console.log("[Bot Global Init] Starting initialization...");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        throw new Error("FATAL: Missing one or more environment variables!");
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY); // Инициализируем genAI
    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Clients and bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    // Обработчик /start
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received."); // ЛОГ
        const userId = ctx.from?.id;
        const chatId = ctx.chat.id;
        if (!userId || !chatId) { console.warn("[Bot Handler /start] No user ID or chat ID."); return; }
        console.log(`[Bot Handler /start] User ${userId} in chat ${chatId}`);
        try {
            const userData = await getOrCreateUser(supabaseAdmin, userId);
            if (!userData || !userData.id) throw new Error("Failed to retrieve user data.");
            console.log(`[Bot Handler /start] User data: ID=${userData.id}, Claimed=${userData.claimed}, LastMsgId=${userData.lastMessageId}`);
            // Удаление предыдущего сообщения
            if (userData.lastMessageId) {
                console.log(`[Bot Handler /start] Attempting delete msg ${userData.lastMessageId}`);
                await ctx.api.deleteMessage(chatId, userData.lastMessageId).catch(async (deleteError) => {
                    if (deleteError instanceof GrammyError && (deleteError.error_code === 400 && deleteError.description.includes("message to delete not found"))) {
                        console.log(`[Bot Handler /start] Msg ${userData.lastMessageId} not found.`);
                        await supabaseAdmin.from('users').update({ last_start_message_id: null }).eq('id', userData.id).catch(e => console.error("Failed reset last msg id:", e));
                    } else { console.error(`[Bot Handler /start] Failed delete msg ${userData.lastMessageId}:`, deleteError); }
                });
            }
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
        } catch (e) {
             console.error("[Bot Handler /start] CRITICAL Error:", e);
             try { await ctx.reply("Произошла ошибка при обработке команды.").catch(logReplyError); } catch {}
        }
    });

    // Обработчик текстовых сообщений
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler text] Received text message."); // ЛОГ
        const dreamText = ctx.message.text; const userId = ctx.from?.id; const chatId = ctx.chat.id; const messageId = ctx.message.message_id;
        if (!userId || !chatId) { console.warn("[Bot Handler text] No user/chat ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler text] Ignoring command.`); return; }
        console.log(`[Bot Handler text] Processing dream for ${userId}`);
        let statusMessage;
        try {
            console.log(`[Bot Handler text] Deleting user message ${messageId}`);
            await ctx.api.deleteMessage(chatId, messageId).catch(delErr => { if (!(delErr instanceof GrammyError && delErr.error_code === 400 && delErr.description.includes("message to delete not found"))) { console.warn(`[Bot Handler text] Failed delete user msg ${messageId}:`, delErr); }});
            statusMessage = await ctx.reply("Анализирую ваш сон... 🧠✨").catch(logReplyError);
            if (!statusMessage) throw new Error("Failed to send status message.");
            await analyzeDream(ctx, supabaseAdmin, dreamText); // Вызываем анализ
            console.log(`[Bot Handler text] Deleting status message ${statusMessage.message_id}`);
            await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(delErr => { console.warn(`[Bot Handler text] Failed delete status msg ${statusMessage.message_id}:`, delErr); });
            console.log(`[Bot Handler text] Analysis complete. Sending confirmation.`);
            await ctx.reply("Ваш анализ сна готов и сохранен! ✨\n\nПосмотрите его в истории в Личном кабинете.", { reply_markup: { inline_keyboard: [[{ text: "Открыть Личный кабинет", web_app: { url: TMA_URL } }]] } }).catch(logReplyError);
        } catch (error) {
            console.error(`[Bot Handler text] Error processing dream for ${userId}:`, error);
            if (statusMessage) { await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(e => {}); }
            await ctx.reply(`Произошла ошибка: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
        }
    });

    // Другие обработчики
    bot.on('pre_checkout_query', async (ctx) => { /* ... ваш код ... */ });
    bot.on('message:successful_payment', async (ctx) => { /* ... ваш код с RPC ... */ });

    // Глобальный обработчик ошибок grammy
    bot.catch((err) => {
        const ctx = err.ctx; const e = err.error;
        console.error(`[Bot Global Error Handler] Error for update ${ctx?.update?.update_id}:`);
        if (e instanceof GrammyError) { console.error("GrammyError:", e.description, e.payload ? JSON.stringify(e.payload) : ''); }
        else if (e instanceof HttpError) { console.error("HttpError:", e); }
        else if (e instanceof Error) { console.error("Error:", e.stack || e.message); }
        else { console.error("Unknown error:", e); }
    });

    console.log("[Bot Global Init] Handlers setup complete.");
    botInitializedAndHandlersSet = true; // Ставим флаг успеха

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error;
    bot = null; // Сбрасываем бота при ошибке
    botInitializedAndHandlersSet = false;
}

// --- Вспомогательные Функции ---
// Убедитесь, что ваш актуальный код этих функций здесь
async function getOrCreateUser(supabase, userId) { /* ... ваш код с return { id, claimed, lastMessageId } ... */ }
async function getGeminiAnalysis(dreamText) { /* ... ваш код с инициализацией geminiModel внутри ... */ }
async function analyzeDream(ctx, supabase, dreamText) { /* ... ваш код, который выбрасывает ошибки ... */ }
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }

// --- Создаем обработчик webhookCallback ЗАРАНЕЕ ---
// Делаем это вне try...catch, чтобы видеть ошибки самого webhookCallback, если они есть
let netlifyWebhookHandler = null;
if (botInitializedAndHandlersSet && bot) {
    try {
        // Используем 'aws-lambda-async' для полной совместимости с async/await Netlify
        netlifyWebhookHandler = webhookCallback(bot, 'aws-lambda-async');
        console.log("[Bot Global Init] webhookCallback created successfully.");
    } catch (callbackError) {
        console.error("[Bot Global Init] FAILED TO CREATE webhookCallback:", callbackError);
        initializationError = callbackError; // Сохраняем и эту ошибку
    }
} else {
     console.error("[Bot Global Init] Skipping webhookCallback creation due to initialization errors.");
     // initializationError уже должен быть установлен выше
}


// --- Экспорт обработчика для Netlify с webhookCallback ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");

    // Проверяем ошибки инициализации ИЛИ создания webhookCallback
    if (initializationError || !netlifyWebhookHandler) {
        console.error("[Netlify Handler] Initialization or webhookCallback creation failed.", initializationError);
        return { statusCode: 500, body: "Internal Server Error: Bot failed to initialize or configure." };
    }

    // Если все готово, просто вызываем созданный обработчик
    console.log("[Netlify Handler] Calling pre-created webhookCallback handler...");
    // Передаем событие Netlify в готовый обработчик grammY
    return netlifyWebhookHandler(event);
};

console.log("[Bot Global Init] Netlify handler exported.");
