// bot/functions/bot.js (Попытка №4: Используем webhookCallback)

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError, webhookCallback } = require("grammy"); // Убедимся, что webhookCallback импортирован
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Получение Переменных Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Инициализация ---
// Создаем инстанс бота ГЛОБАЛЬНО, чтобы он был доступен в хендлере
let bot;
let supabaseAdmin;
let geminiModel;
let initializationError = null; // Храним ошибку инициализации

try {
    console.log("[Bot Global Init] Initializing clients and bot...");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        throw new Error("FATAL: Missing environment variables!");
    }
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Basic bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    // Обработчик /start
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received."); // <--- ЛОГ
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot Handler /start] No user ID."); return; }
        console.log(`[Bot Handler /start] User ${userId}`);
        try {
            await getOrCreateUser(supabaseAdmin, userId); // Использует глобальный supabaseAdmin
            console.log(`[Bot Handler /start] Ensured user ${userId} exists.`);
            const welcomeMessage = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой **первый бесплатный токен** за подписку на канал!";
            const buttonUrl = `${TMA_URL}?action=claim_reward`;
            await ctx.replyWithMarkdown(welcomeMessage, { reply_markup: { inline_keyboard: [[{ text: "🎁 Открыть приложение и получить токен", web_app: { url: buttonUrl } }]] } }).catch(logReplyError);
            console.log(`[Bot Handler /start] Welcome message sent to ${userId}.`);
        } catch (e) { console.error("[Bot Handler /start] Error:", e); await ctx.reply("Ошибка при запуске.").catch(logReplyError); }
    });

    // Обработчик текстовых сообщений
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler message:text] Text received."); // <--- ЛОГ
        const dreamText = ctx.message.text;
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot Handler message:text] No user ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler message:text] Ignoring command.`); return; }
        console.log(`[Bot Handler message:text] Processing dream for ${userId}`);
        // Используем глобальные клиенты
        await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText);
    });

    // Обработчик pre_checkout_query
    bot.on('pre_checkout_query', async (ctx) => { /* ... (без изменений) ... */ });
    // Обработчик successful_payment (использует RPC)
    bot.on('message:successful_payment', async (ctx) => { /* ... (без изменений, использует глобальный supabaseAdmin) ... */ });
    // Обработчик ошибок
    bot.catch((err) => { /* ... (без изменений) ... */ });

    console.log("[Bot Global Init] Handlers configured successfully.");

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error; // Сохраняем ошибку
    // Не создаем инстанс bot, если была ошибка
    bot = null;
}

// --- Вспомогательные Функции ---
// (getOrCreateUser, getGeminiAnalysis, analyzeDream, logReplyError должны быть здесь)
async function getOrCreateUser(supabase, userId) { /* ... ваш код с tokens: 0 ... */ }
async function getGeminiAnalysis(geminiModel, dreamText) { /* ... ваш код ... */ }
async function analyzeDream(ctx, supabase, geminiModel, dreamText) { /* ... ваш код ... */ }
function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function с webhookCallback ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked."); // Лог вызова

    // Проверяем, была ли ошибка при инициализации
    if (initializationError || !bot) {
        console.error("[Netlify Handler] Bot initialization failed previously. Returning 500.", initializationError);
        return { statusCode: 500, body: "Internal Server Error: Bot failed to initialize." };
    }

    try {
        // Создаем обработчик вебхука для AWS Lambda (совместим с Netlify)
        const callback = webhookCallback(bot, 'aws-lambda');
        console.log("[Netlify Handler] Calling webhookCallback...");

        // Передаем событие Netlify в обработчик grammY
        const response = await callback(event);
        console.log("[Netlify Handler] webhookCallback finished. Response status:", response.statusCode);

        // Возвращаем ответ, сформированный grammY
        return response;

    } catch (error) {
        // Ловим ошибки, которые могли возникнуть ВНУТРИ webhookCallback,
        // хотя bot.catch должен ловить большинство из них.
        console.error("[Netlify Handler] CRITICAL error during webhookCallback execution:", error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Internal Server Error during webhook processing." })
        };
    }
};
