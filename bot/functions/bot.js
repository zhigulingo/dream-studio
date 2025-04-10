// bot/functions/bot.js (Попытка №7: Ручной handler + bot.init())

const { Bot, Api, GrammyError, HttpError } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto'); // Оставим для возможных нужд

// --- Переменные Окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Проверка Переменных Окружения при загрузке ---
if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
    console.error("[Bot Global Init] FATAL: Missing one or more environment variables!");
    // Выбрасываем ошибку, чтобы предотвратить запуск функции с неполной конфигурацией
    throw new Error("Missing critical environment variables. Function cannot start.");
}

// --- Глобальная Инициализация Клиентов ---
// (Инициализируем сразу, чтобы избежать задержек в обработчике)
console.log("[Bot Global Init] Initializing clients and bot instance...");
let supabaseAdmin;
let genAI;
let geminiModel = null; // Инициализируем как null
let bot;
let initializationError = null;

try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY); // Создаем экземпляр genAI
    // НЕ инициализируем geminiModel здесь, сделаем это в getGeminiAnalysis
    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Clients and bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    // Обработчик /start (С удалением и разными сообщениями)
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received.");
        const userId = ctx.from?.id;
        const chatId = ctx.chat.id;
        if (!userId || !chatId) { console.warn("[Bot Handler /start] No user ID or chat ID."); return; }
        console.log(`[Bot Handler /start] User ${userId} in chat ${chatId}`);
        let userData;
        try {
            userData = await getOrCreateUser(supabaseAdmin, userId); // Используем глобальный supabaseAdmin
            if (!userData || !userData.id) throw new Error("Failed to retrieve user data.");
            console.log(`[Bot Handler /start] User data: ID=${userData.id}, Claimed=${userData.claimed}, LastMsgId=${userData.lastMessageId}`);
            // Удаление предыдущего сообщения
            if (userData.lastMessageId) {
                console.log(`[Bot Handler /start] Attempting to delete previous message ${userData.lastMessageId}`);
                await ctx.api.deleteMessage(chatId, userData.lastMessageId).catch(async (deleteError) => {
                    if (deleteError instanceof GrammyError && (deleteError.error_code === 400 && deleteError.description.includes("message to delete not found"))) {
                        console.log(`[Bot Handler /start] Previous message ${userData.lastMessageId} not found.`);
                        const { error: resetError } = await supabaseAdmin.from('users').update({ last_start_message_id: null }).eq('id', userData.id);
                        if (resetError) console.error(`[Bot Handler /start] Failed to reset missing last_start_message_id:`, resetError);
                    } else { console.error(`[Bot Handler /start] Failed to delete message ${userData.lastMessageId}:`, deleteError); }
                });
            }
            // Определение текста и кнопки
            let messageText, buttonText, buttonUrl;
            if (userData.claimed) { messageText = "С возвращением! 👋 Анализируй сны, отправляя их мне, или загляни в Личный кабинет."; buttonText = "Личный кабинет"; buttonUrl = TMA_URL; }
            else { messageText = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой <b>первый бесплатный токен</b> за подписку на канал!"; buttonText = "🎁 Открыть приложение и получить токен"; buttonUrl = `${TMA_URL}?action=claim_reward`; }
            // Отправка нового сообщения
            console.log(`[Bot Handler /start] Sending new message (Claimed: ${userData.claimed})`);
            const sentMessage = await ctx.reply(messageText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url: buttonUrl } }]] } });
            console.log(`[Bot Handler /start] New message sent. ID: ${sentMessage.message_id}`);
            // Сохранение ID нового сообщения
            const { error: updateError } = await supabaseAdmin.from('users').update({ last_start_message_id: sentMessage.message_id }).eq('id', userData.id);
            if (updateError) { console.error(`[Bot Handler /start] Failed to update last_start_message_id:`, updateError); }
            else { console.log(`[Bot Handler /start] Updated last_start_message_id to ${sentMessage.message_id}.`); }
        } catch (e) {
             console.error("[Bot Handler /start] CRITICAL Error:", e);
             // Пытаемся отправить сообщение об ошибке, если возможно
             try { await ctx.reply("Произошла серьезная ошибка при обработке команды.").catch(logReplyError); } catch {}
        }
    });

    // Обработчик текстовых сообщений (с удалением и без ответа анализом)
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler text] Received text message.");
        const dreamText = ctx.message.text; const userId = ctx.from?.id; const chatId = ctx.chat.id; const messageId = ctx.message.message_id;
        if (!userId || !chatId) { console.warn("[Bot Handler text] No user/chat ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler text] Ignoring command.`); return; }

        console.log(`[Bot Handler text] Processing dream for ${userId}`);
        let statusMessage;
        try {
            // Удаляем сообщение пользователя
            console.log(`[Bot Handler text] Deleting user message ${messageId}`);
            await ctx.api.deleteMessage(chatId, messageId).catch(delErr => { if (!(delErr instanceof GrammyError && delErr.error_code === 400 && delErr.description.includes("message to delete not found"))) { console.warn(`[Bot Handler text] Failed to delete user message ${messageId}:`, delErr); }});
            // Отправляем статус
            statusMessage = await ctx.reply("Анализирую ваш сон... 🧠✨").catch(logReplyError);
            if (!statusMessage) throw new Error("Failed to send status message.");
            // Вызываем анализ (он выбрасывает ошибку при неудаче)
            await analyzeDream(ctx, supabaseAdmin, dreamText); // Использует глобальный supabaseAdmin
            // Удаляем статус
             console.log(`[Bot Handler text] Deleting status message ${statusMessage.message_id}`);
            await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(delErr => { console.warn(`[Bot Handler text] Failed to delete status message ${statusMessage.message_id}:`, delErr); });
            // Отправляем подтверждение
            console.log(`[Bot Handler text] Analysis complete. Sending confirmation.`);
            await ctx.reply("Ваш анализ сна готов и сохранен! ✨\n\nВы можете посмотреть его в истории в Личном кабинете.", { reply_markup: { inline_keyboard: [[{ text: "Открыть Личный кабинет", web_app: { url: TMA_URL } }]] } }).catch(logReplyError);
        } catch (error) {
            console.error(`[Bot Handler text] Error processing dream for ${userId}:`, error);
            if (statusMessage) { await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(e => {}); }
            await ctx.reply(`Произошла ошибка: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
        }
    });

    // Другие обработчики (pre_checkout_query, successful_payment)
    bot.on('pre_checkout_query', async (ctx) => { /* ... ваш код ... */ });
    bot.on('message:successful_payment', async (ctx) => { /* ... ваш код с RPC ... */ });

    // Глобальный обработчик ошибок grammy
    bot.catch((err) => {
        const ctx = err.ctx; const e = err.error;
        console.error(`[Bot Global Error Handler] Error for update ${ctx?.update?.update_id}:`);
        // Логируем разные типы ошибок
        if (e instanceof GrammyError) { console.error("GrammyError:", e.description, e.payload ? JSON.stringify(e.payload) : ''); }
        else if (e instanceof HttpError) { console.error("HttpError:", e); }
        else if (e instanceof Error) { console.error("Error:", e.stack || e.message); } // Добавляем stack trace
        else { console.error("Unknown error:", e); }
    });

    console.log("[Bot Global Init] Handlers configured successfully.");

} catch (error) {
    // Ловим ошибки инициализации Supabase, GenAI, Bot
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error; // Сохраняем ошибку
    bot = null; // Убеждаемся, что бот не будет использоваться
}

// --- Вспомогательные Функции ---
// Убедитесь, что код этих функций здесь актуален
async function getOrCreateUser(supabase, userId) { /* ... ваш код с return { id, claimed, lastMessageId } ... */ }
async function getGeminiAnalysis(dreamText) { /* ... ваш код с инициализацией geminiModel внутри ... */ }
async function analyzeDream(ctx, supabase, dreamText) { /* ... ваш код, который выбрасывает ошибки ... */ }
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }

// --- Экспорт обработчика для Netlify (ручной режим) ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");

    // Проверяем ошибки инициализации
    if (initializationError || !bot) {
        console.error("[Netlify Handler] Bot is not initialized due to previous errors.", initializationError);
        return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." };
    }

    if (!event.body) {
        console.warn("[Netlify Handler] Empty event body.");
        return { statusCode: 200, body: "OK (empty body)" }; // ОК для Telegram
    }

    let update;
    try {
        update = JSON.parse(event.body);
        console.log(`[Netlify Handler] Parsed update ID: ${update.update_id}`);
    } catch (e) {
        console.error("[Netlify Handler] Failed to parse JSON body:", e);
        console.error("[Netlify Handler] Raw body:", event.body);
        return { statusCode: 400, body: "Bad Request: Invalid JSON body" };
    }

    try {
        // <<<--- ИСПРАВЛЕНИЕ: ДОБАВЛЯЕМ bot.init() ---
        // Это нужно перед КАЖДЫМ handleUpdate, если не передавать botInfo вручную
        console.log(`[Netlify Handler] Calling bot.init() for update ${update.update_id}...`);
        await bot.init(); // Получаем информацию о боте (ID, username и т.д.)
        console.log(`[Netlify Handler] bot.init() successful. Calling bot.handleUpdate...`);
        // <<<--- КОНЕЦ ИСПРАВЛЕНИЯ ---

        await bot.handleUpdate(update);
        console.log(`[Netlify Handler] Update ${update.update_id} processed by grammy.`);
        return { statusCode: 200, body: "" }; // ОК для Telegram

    } catch (error) {
        // Ловим ошибки из bot.init() или bot.handleUpdate(), которые не поймал bot.catch
        console.error(`[Netlify Handler] UNEXPECTED error during bot processing for update ${update.update_id}:`, error);
        // Возвращаем 200 OK, чтобы Telegram не повторял, но логируем ошибку
        return { statusCode: 200, body: "OK (internal processing error)" };
    }
};

console.log("[Bot Global Init] Netlify handler configured manually."); // Сообщение о завершении загрузки файла
