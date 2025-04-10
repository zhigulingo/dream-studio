// bot/functions/bot.js (Попытка №8: Исправлен catch в getOrCreateUser)

const { Bot, Api, GrammyError, HttpError } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Переменные Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
    console.error("[Bot Global Init] FATAL: Missing one or more environment variables!");
    throw new Error("Missing critical environment variables. Function cannot start.");
}

// --- Глобальная Инициализация ---
console.log("[Bot Global Init] Initializing clients and bot instance...");
let supabaseAdmin;
let genAI;
let geminiModel = null;
let bot;
let initializationError = null;

try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Clients and bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    bot.command("start", async (ctx) => { /* ... (код обработчика start без изменений) ... */ });
    bot.on("message:text", async (ctx) => { /* ... (код обработчика text без изменений) ... */ });
    bot.on('pre_checkout_query', async (ctx) => { /* ... (код обработчика pre_checkout_query без изменений) ... */ });
    bot.on('message:successful_payment', async (ctx) => { /* ... (код обработчика successful_payment без изменений) ... */ });
    bot.catch((err) => { /* ... (код обработчика catch без изменений) ... */ });

    console.log("[Bot Global Init] Handlers configured successfully.");

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error;
    bot = null;
}

// --- Вспомогательные Функции ---

// getOrCreateUser (ИСПРАВЛЕН catch блок)
async function getOrCreateUser(supabase, userId) {
    if (!supabase) {
         console.error("[getOrCreateUser] Supabase client is null or undefined!");
         // Выбрасываем ошибку, чтобы она была видна в логах вызывающей функции
         throw new Error("Supabase client not available in getOrCreateUser.");
    }
    console.log(`[getOrCreateUser] Attempting to get/create user ${userId}...`); // Лог начала функции

    try {
        // 1. Пытаемся найти пользователя
        console.log(`[getOrCreateUser] Selecting user ${userId}...`);
        let { data: existingUser, error: selectError } = await supabase
            .from('users')
            .select('id, channel_reward_claimed, last_start_message_id')
            .eq('tg_id', userId)
            .single();

        // Логируем результат SELECT
        if (selectError && selectError.code !== 'PGRST116') {
             console.error(`[getOrCreateUser] Supabase SELECT error for ${userId}:`, selectError);
             // Пробрасываем ошибку Supabase
             throw new Error(`Supabase select error: ${selectError.message}`);
        }

        if (existingUser) {
            console.log(`[getOrCreateUser] Existing user found: ${userId}, ID: ${existingUser.id}, Claimed: ${existingUser.channel_reward_claimed}, LastMsg: ${existingUser.last_start_message_id}`);
            return {
                id: existingUser.id,
                claimed: existingUser.channel_reward_claimed ?? false,
                lastMessageId: existingUser.last_start_message_id
            };
        } else {
            // Пользователь не найден (selectError.code === 'PGRST116')
            console.log(`[getOrCreateUser] User ${userId} not found. Creating new user...`);
            // 2. Создаем нового пользователя
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({ tg_id: userId, subscription_type: 'free', tokens: 0, channel_reward_claimed: false })
                .select('id')
                .single();

            // Логируем результат INSERT
            if (insertError) {
                console.error(`[getOrCreateUser] Supabase INSERT error for ${userId}:`, insertError);
                 // Обработка гонки запросов (если кто-то успел создать пользователя)
                 if (insertError.code === '23505') { // Код ошибки unique_violation
                     console.warn(`[getOrCreateUser] Race condition likely for user ${userId}. Re-fetching...`);
                     // Повторно ищем пользователя
                     let { data: raceUser, error: raceError } = await supabase.from('users').select('id, channel_reward_claimed, last_start_message_id').eq('tg_id', userId).single();
                     // Если ошибка при повторном поиске
                     if (raceError) {
                          console.error(`[getOrCreateUser] Supabase re-fetch error for ${userId}:`, raceError);
                          throw new Error(`Supabase re-fetch error: ${raceError.message}`);
                     }
                     // Если пользователь найден при повторном поиске
                     if (raceUser) {
                         console.log(`[getOrCreateUser] Found user ${userId} on re-fetch after race condition.`);
                         return { id: raceUser.id, claimed: raceUser.channel_reward_claimed ?? false, lastMessageId: raceUser.last_start_message_id };
                     } else {
                          // Странная ситуация: ошибка unique_violation, но пользователя не нашли
                          console.error(`[getOrCreateUser] Unique violation for ${userId}, but user not found on re-fetch.`);
                          throw new Error("Inconsistent state after unique violation.");
                     }
                 }
                 // Если другая ошибка вставки, пробрасываем ее
                 throw new Error(`Supabase insert error: ${insertError.message}`);
            }
            if (!newUser) {
                 console.error(`[getOrCreateUser] User creation for ${userId} successful but returned no data.`);
                 throw new Error("User creation returned no data."); // Ошибка, если Supabase не вернул ID
            }

            console.log(`[getOrCreateUser] Created new user: tg_id=${userId}, id=${newUser.id}`);
            return { id: newUser.id, claimed: false, lastMessageId: null }; // Возвращаем данные нового юзера
        }
    } catch (error) { // <<<--- ИСПРАВЛЕННЫЙ CATCH БЛОК ---
        // Логируем ошибку, которая произошла ВНУТРИ try блока
        console.error(`[getOrCreateUser] Error during get/create process for ${userId}:`, error);
        // ПРОБРАСЫВАЕМ ошибку дальше, чтобы ее поймал catch в /start
        // и мы увидели конкретную причину в логах /start
        throw error; // Не возвращаем null, а именно пробрасываем!
        // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ---
    }
}


// getGeminiAnalysis (без изменений)
async function getGeminiAnalysis(dreamText) { /* ... */ }
// analyzeDream (без изменений)
async function analyzeDream(ctx, supabase, dreamText) { /* ... */ }
// logReplyError (без изменений)
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }

// --- Экспорт обработчика для Netlify (ручной режим с bot.init()) ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");
    if (initializationError || !bot) { console.error("[Netlify Handler] Bot is not initialized.", initializationError); return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." }; }
    if (!event.body) { console.warn("[Netlify Handler] Empty event body."); return { statusCode: 200, body: "OK (empty body)" }; }
    let update;
    try { update = JSON.parse(event.body); console.log(`[Netlify Handler] Parsed update ID: ${update.update_id}`); }
    catch (e) { console.error("[Netlify Handler] Failed to parse JSON body:", e, "Raw body:", event.body); return { statusCode: 400, body: "Bad Request: Invalid JSON body" }; }

    try {
        console.log(`[Netlify Handler] Calling bot.init() for update ${update.update_id}...`);
        await bot.init();
        console.log(`[Netlify Handler] bot.init() successful. Calling bot.handleUpdate...`);
        await bot.handleUpdate(update);
        console.log(`[Netlify Handler] Update ${update.update_id} processed by grammy.`);
        return { statusCode: 200, body: "" };
    } catch (error) {
        console.error(`[Netlify Handler] UNEXPECTED error during bot processing for update ${update.update_id}:`, error);
        return { statusCode: 200, body: "OK (internal processing error)" }; // Все равно ОК для Telegram
    }
};

console.log("[Bot Global Init] Netlify handler configured manually.");
