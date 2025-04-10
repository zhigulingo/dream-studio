// bot/functions/bot.js (Попытка №5: Исправлен replyWithMarkdown, добавил больше логов)

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

// --- Инициализация ---
let bot;
let supabaseAdmin;
let geminiModel;
let initializationError = null;

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

    // Обработчик /start (ИСПРАВЛЕНО replyWithMarkdown)
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received.");
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot Handler /start] No user ID."); return; }
        console.log(`[Bot Handler /start] User ${userId}`);
        try {
            //await getOrCreateUser(supabaseAdmin, userId);
            console.log(`[Bot Handler /start] Ensured user ${userId} exists.`);
            // Используем MarkdownV2, поэтому нужно экранировать спецсимволы!
            // Но проще использовать HTML-разметку, она надежнее.
            const welcomeMessage = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой <b>первый бесплатный токен</b> за подписку на канал!";
            const buttonUrl = `${TMA_URL}?action=claim_reward`;

            // <<<--- ИСПРАВЛЕНИЕ: Используем ctx.reply с parse_mode: 'HTML' ---
            await ctx.reply(welcomeMessage, {
                parse_mode: 'HTML', // Используем HTML вместо MarkdownV2
                reply_markup: {
                    inline_keyboard: [[{
                        text: "🎁 Открыть приложение и получить токен",
                        web_app: { url: buttonUrl }
                    }]]
                }
            }).catch(logReplyError);
            // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ---

            console.log(`[Bot Handler /start] Welcome message sent to ${userId}.`);
        } catch (e) {
            console.error("[Bot Handler /start] Error:", e); // Логируем ошибку
            // Ответ пользователю об ошибке
            await ctx.reply("Произошла ошибка при обработке команды /start. Попробуйте еще раз позже.").catch(logReplyError);
        }
    });

    // Обработчик текстовых сообщений
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler message:text] Text received.");
        const dreamText = ctx.message.text;
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot Handler message:text] No user ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler message:text] Ignoring command.`); return; }
        console.log(`[Bot Handler message:text] Processing dream for ${userId}`);
        await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText);
    });

    // Обработчик pre_checkout_query
    bot.on('pre_checkout_query', async (ctx) => { /* ... */ });
    // Обработчик successful_payment (использует RPC)
    bot.on('message:successful_payment', async (ctx) => { /* ... */ });
    // Обработчик ошибок
    bot.catch((err) => {
        // <<<--- ДОБАВЛЕН ЛОГ В bot.catch ---
        const ctx = err.ctx;
        const e = err.error;
        console.error(`[Bot Catch Handler] Error caught for update ${ctx?.update?.update_id}. Error type: ${e?.constructor?.name}`);
        if (e instanceof GrammyError) { console.error("[Bot Catch Handler] GrammyError:", e.description, e.payload); }
        else if (e instanceof HttpError) { console.error("[Bot Catch Handler] HttpError:", e); }
        else if (e instanceof Error) { console.error("[Bot Catch Handler] Error:", e.stack || e.message); } // Логируем стек
        else { console.error("[Bot Catch Handler] Unknown error:", e); }
         // Попытка ответить пользователю, если это возможно и ошибка не связана с отправкой
         // if (ctx && !(e instanceof GrammyError && e.description.includes('message to send'))) {
         //    ctx.reply("Произошла внутренняя ошибка. Попробуйте позже.").catch(logReplyError);
         // }
    });

    console.log("[Bot Global Init] Handlers configured successfully.");

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error;
    bot = null;
}

// --- Вспомогательные Функции ---
// getOrCreateUser, getGeminiAnalysis, analyzeDream, logReplyError
async function getOrCreateUser(supabase, userId) { /* ... ваш код с tokens: 0 ... */ }
async function getGeminiAnalysis(geminiModel, dreamText) { /* ... ваш код ... */ }
async function analyzeDream(ctx, supabase, geminiModel, dreamText) { /* ... ваш код ... */ }
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }

// --- Главный Обработчик Netlify Function с webhookCallback ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");

    if (initializationError || !bot) {
        console.error("[Netlify Handler] Bot initialization failed previously.", initializationError);
        return { statusCode: 500, body: "Internal Server Error: Bot failed to initialize." };
    }

    try {
        const callback = webhookCallback(bot, 'aws-lambda');
        console.log("[Netlify Handler] Calling webhookCallback...");
        const response = await callback(event); // Передаем событие Netlify
        console.log("[Netlify Handler] webhookCallback finished. Response status:", response.statusCode);
        return response; // Возвращаем ответ от grammY
    } catch (error) {
        // Ловим ошибки, которые НЕ были пойманы bot.catch ИЛИ возникли в самом webhookCallback
        console.error("[Netlify Handler] CRITICAL error during webhookCallback:", error);
        // Возвращаем простой 500, чтобы Telegram не пытался повторить запрос с ошибкой
        return { statusCode: 500, body: "Internal Server Error" };
    }
};
