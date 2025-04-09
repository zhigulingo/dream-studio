// bot/functions/bot.js (Исправлено: ВОЗВРАЩЕН bot.init())

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Получение Переменных Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Вспомогательные Функции ---

// Функция получения/создания пользователя (tokens: 0)
async function getOrCreateUser(supabase, userId) {
    // ... (код функции без изменений) ...
     if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
     try {
         let { data: existingUser, error: selectError } = await supabase
             .from('users').select('id, tokens').eq('tg_id', userId).single();
         if (selectError && selectError.code !== 'PGRST116') { console.error(`[Bot:getOrCreateUser] Error selecting user ${userId}:`, selectError); throw selectError; }
         if (existingUser) { console.log(`[Bot:getOrCreateUser] Existing user found: tg_id=${userId}, id=${existingUser.id}, tokens=${existingUser.tokens}`); return existingUser.id; }
         else {
             console.log(`[Bot:getOrCreateUser] User ${userId} not found. Creating...`);
             const { data: newUser, error: insertError } = await supabase
                 .from('users').insert({ tg_id: userId, subscription_type: 'free', tokens: 0, channel_reward_claimed: false }).select('id').single();
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

// Функция анализа сна (БЕЗ ИЗМЕНЕНИЙ)
async function getGeminiAnalysis(geminiModel, dreamText) { /* ... */ }
// Функция обработки запроса анализа (БЕЗ ИЗМЕНЕНИЙ)
async function analyzeDream(ctx, supabase, geminiModel, dreamText) { /* ... */ }
// Функция логирования ошибок отправки (БЕЗ ИЗМЕНЕНИЙ)
function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Bot] Handler invoked.");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) { console.error("[Bot] FATAL: Missing env vars!"); return { statusCode: 500, body: "Config missing." }; }
    if (!event.body) { console.warn("[Bot] Empty event body."); return { statusCode: 400, body: "Bad Request" }; }
    let update; try { update = JSON.parse(event.body); } catch (e) { console.error("[Bot] Invalid JSON body:", e); return { statusCode: 400, body: "Invalid JSON" }; }

    let supabaseAdmin; let geminiModel; let bot;
    try {
        console.log("[Bot] Initializing clients...");
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        bot = new Bot(BOT_TOKEN);
        // --- ИСПРАВЛЕНИЕ: ВОЗВРАЩАЕМ ИНИЦИАЛИЗАЦИЮ БОТА ---
        await bot.init(); // <<<--- ЭТА СТРОКА ВОЗВРАЩЕНА
        // --- КОНЕЦ ИСПРАВЛЕНИЯ ---
        console.log("[Bot] Clients initialized.");
    } catch (initError) {
        // Логируем ошибку инициализации подробнее
        console.error("[Bot] FATAL: Client initialization failed:", initError instanceof Error ? initError.stack : initError);
        return { statusCode: 500, body: "Initialization failed." };
    }

    // --- Настройка Обработчиков ---
    console.log("[Bot] Setting up handlers...");
    // Обработчик /start
    bot.command("start", async (ctx) => { /* ... (без изменений) ... */ });
    // Обработчик текстовых сообщений
    bot.on("message:text", async (ctx) => { /* ... (без изменений) ... */ });
    // Обработчик pre_checkout_query
    bot.on('pre_checkout_query', async (ctx) => { /* ... (без изменений) ... */ });
    // Обработчик successful_payment (использует RPC)
    bot.on('message:successful_payment', async (ctx) => { /* ... (без изменений) ... */ });
    // Обработчик ошибок
    bot.catch((err) => { /* ... (без изменений) ... */ });
    console.log("[Bot] Handlers configured.");

    // --- Обработка обновления ---
    try {
        console.log("[Bot] Passing update to bot.handleUpdate...");
        await bot.handleUpdate(update);
        console.log("[Bot] bot.handleUpdate finished.");
        return { statusCode: 200, body: "" };
    } catch (error) {
        // Эта ошибка теперь не должна возникать, но оставляем на всякий случай
        console.error("[Bot] Error during bot.handleUpdate call:", error instanceof Error ? error.stack : error);
        return { statusCode: 500, body: "Internal Server Error during update processing." };
    }
};
