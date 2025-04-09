// bot/functions/bot.js (Попытка №3: Измененная инициализация, больше логов)

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError, webhookCallback } = require("grammy"); // Добавили webhookCallback
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

// --- Получение Переменных Окружения ---
// (Проверьте их наличие и правильность в Netlify!)
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Создаем инстанс бота ВНЕ хендлера ---
// Это может помочь сохранить контекст между вызовами в некоторых средах,
// хотя Netlify Functions обычно stateless. Попробуем.
let bot;
let supabaseAdmin;
let geminiModel;
let isBotInitialized = false; // Флаг для однократной инициализации

function initializeClientsAndBot() {
    if (isBotInitialized) {
        console.log("[Bot Init] Already initialized.");
        return;
    }
    console.log("[Bot Init] Initializing clients and bot...");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        console.error("[Bot Init] FATAL: Missing environment variables!");
        // В реальном приложении здесь лучше выбросить ошибку, чтобы Netlify Function упала
        throw new Error("Missing environment variables!");
    }
    try {
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Проверьте модель
        bot = new Bot(BOT_TOKEN);

        // --- Настройка Обработчиков ---
        console.log("[Bot Init] Setting up handlers...");

        // Обработчик /start
        bot.command("start", async (ctx) => {
            // <<<--- ЛОГ ВНУТРИ ОБРАБОТЧИКА ---
            console.log("[Bot Handler /start] Command received in handler.");
            const userId = ctx.from?.id;
            if (!userId) { console.warn("[Bot Handler /start] No user ID in context."); return; }
            console.log(`[Bot Handler /start] Processing for User ${userId}`);
            try {
                await getOrCreateUser(supabaseAdmin, userId);
                console.log(`[Bot Handler /start] Ensured user ${userId} exists.`);
                const welcomeMessage = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой **первый бесплатный токен** за подписку на канал!";
                const buttonUrl = `${TMA_URL}?action=claim_reward`;
                await ctx.replyWithMarkdown(welcomeMessage, {
                    reply_markup: { inline_keyboard: [[{ text: "🎁 Открыть приложение и получить токен", web_app: { url: buttonUrl } }]] }
                }).catch(logReplyError);
                 console.log(`[Bot Handler /start] Welcome message sent to ${userId}.`);
            } catch (e) {
                console.error("[Bot Handler /start] Error:", e);
                await ctx.reply("Произошла ошибка при запуске. Попробуйте команду /start еще раз.").catch(logReplyError);
            }
        });

        // Обработчик текстовых сообщений
        bot.on("message:text", async (ctx) => {
             // <<<--- ЛОГ ВНУТРИ ОБРАБОТЧИКА ---
            console.log("[Bot Handler message:text] Text message received in handler.");
            const dreamText = ctx.message.text;
            const userId = ctx.from?.id;
            if (!userId) { console.warn("[Bot Handler message:text] No user ID in context."); return; }
            if (dreamText.startsWith('/')) { console.log(`[Bot Handler message:text] Ignoring command: ${dreamText}`); return; }
            console.log(`[Bot Handler message:text] Processing dream for ${userId}`);
            // Передаем инициализированные клиенты
            await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText);
        });

        // Обработчик pre_checkout_query
        bot.on('pre_checkout_query', async (ctx) => {
            console.log("[Bot Handler pre_checkout_query] Received:", JSON.stringify(ctx.preCheckoutQuery));
            try { await ctx.answerPreCheckoutQuery(true); console.log("[Bot Handler pre_checkout_query] Answered TRUE."); }
            catch (error) { console.error("[Bot Handler pre_checkout_query] Failed to answer:", error); try { await ctx.answerPreCheckoutQuery(false, "Internal error"); } catch (e) {} }
        });

        // Обработчик successful_payment (использует RPC)
        bot.on('message:successful_payment', async (ctx) => {
             console.log("[Bot Handler successful_payment] Received:", JSON.stringify(ctx.message.successful_payment));
             const payment = ctx.message.successful_payment; const userId = ctx.from.id;
             const payload = payment.invoice_payload;
             if (!payload) { console.error(`[Bot Handler successful_payment] Missing payload for user ${userId}`); return; }
             const parts = payload.split('_');
             if (parts.length < 4 || parts[0] !== 'sub') { console.error(`[Bot Handler successful_payment] Invalid payload: ${payload} from user ${userId}`); return; }
             const plan = parts[1]; const durationMonths = parseInt(parts[2].replace('mo', ''), 10); const payloadUserId = parseInt(parts[3], 10);
             if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) { console.error(`[Bot Handler successful_payment] Payload error/mismatch: Payload=${payload}, Sender=${userId}`); await ctx.reply("Платеж получен с некорректными данными. Свяжитесь с поддержкой.").catch(logReplyError); return; }
             console.log(`[Bot Handler successful_payment] Processing payment for ${userId}: Plan=${plan}, Duration=${durationMonths}mo.`);
             try {
                 if (!supabaseAdmin) { throw new Error("Supabase client unavailable in payment handler"); }
                 const { error: txError } = await supabaseAdmin.rpc('process_successful_payment', { user_tg_id: userId, plan_type: plan, duration_months: durationMonths });
                 if (txError) { console.error(`[Bot Handler successful_payment] RPC error for ${userId}:`, txError); throw new Error("DB update failed."); }
                 console.log(`[Bot Handler successful_payment] Payment processed via RPC for ${userId}.`);
                 await ctx.reply(`Спасибо! Ваша подписка "${plan.toUpperCase()}" успешно активирована/продлена. Токены начислены. ✨`).catch(logReplyError);
             } catch (error) { console.error(`[Bot Handler successful_payment] Failed process payment for ${userId}:`, error); await ctx.reply("Платеж получен, но ошибка обновления. Свяжитесь с поддержкой.").catch(logReplyError); }
        });

        // Обработчик ошибок
        bot.catch((err) => {
            const ctx = err.ctx; const e = err.error;
            console.error(`[Bot Catch Handler] Error for update ${ctx?.update?.update_id}:`);
            if (e instanceof GrammyError) console.error("[Bot Catch Handler] GrammyError:", e.description, e.payload);
            else if (e instanceof HttpError) console.error("[Bot Catch Handler] HttpError:", e);
            else if (e instanceof Error) console.error("[Bot Catch Handler] Error:", e.stack || e.message);
            else console.error("[Bot Catch Handler] Unknown error:", e);
        });

        console.log("[Bot Init] Handlers configured.");
        isBotInitialized = true; // Ставим флаг

    } catch (initError) {
        console.error("[Bot Init] FATAL: Initialization failed:", initError instanceof Error ? initError.stack : initError);
        // Если инициализация не удалась, последующие вызовы handler будут падать
        isBotInitialized = false; // Оставляем false
        // Не бросаем ошибку здесь, чтобы Netlify не отключил функцию навсегда,
        // но логируем как фатальную.
    }
}

// Вызываем инициализацию один раз при загрузке кода функции
initializeClientsAndBot();

// --- Вспомогательные Функции (без изменений) ---
// getOrCreateUser, getGeminiAnalysis, analyzeDream, logReplyError
// (Их код должен быть здесь, как в предыдущих версиях)
async function getOrCreateUser(supabase, userId) { /* ... ваш код ... */ }
async function getGeminiAnalysis(geminiModel, dreamText) { /* ... ваш код ... */ }
async function analyzeDream(ctx, supabase, geminiModel, dreamText) { /* ... ваш код ... */ }
function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }


// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");

    // Проверяем, инициализирован ли бот
    if (!isBotInitialized || !bot) {
         console.error("[Netlify Handler] Bot not initialized! Check initialization logs.");
         // Пытаемся инициализировать снова на всякий случай? Или просто возвращаем ошибку?
         // Лучше вернуть ошибку, чтобы понять, почему не сработала первая инициализация.
         return { statusCode: 500, body: "Internal Server Error: Bot initialization failed." };
    }

    try {
        // Парсим тело запроса
        if (!event.body) { console.warn("[Netlify Handler] Empty event body."); return { statusCode: 400, body: "Bad Request: Empty body" }; }
        const update = JSON.parse(event.body);
        console.log("[Netlify Handler] Received update, passing to bot.handleUpdate...");

        // Обрабатываем обновление через grammY
        await bot.handleUpdate(update);
        console.log("[Netlify Handler] bot.handleUpdate finished successfully.");

        // Если grammY успешно обработал, возвращаем 200 OK
        return { statusCode: 200, body: "" };

    } catch (error) {
         // Ловим ошибки парсинга JSON или КРИТИЧЕСКИЕ ошибки из bot.handleUpdate,
         // которые не были пойманы через bot.catch (маловероятно, но возможно)
        console.error("[Netlify Handler] CRITICAL error during update processing:", error instanceof Error ? error.stack : error);
        return { statusCode: 500, body: "Internal Server Error during update processing." };
    }
};
