// bot/functions/bot.js (С доп. логами)

const { Bot, Api, GrammyError, HttpError } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

// --- Вспомогательные Функции ---
async function getOrCreateUser(supabase, userId) { /* ... */ }
async function getGeminiAnalysis(geminiModel, dreamText) { /* ... */ }
async function analyzeDream(ctx, supabase, geminiModel, dreamText) { /* ... */ }
function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Bot] Handler invoked.");
    // ... проверки переменных и парсинг update ...
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) { /* ... */ }
    if (!event.body) { /* ... */ }
    let update; try { update = JSON.parse(event.body); } catch (e) { /* ... */ }

    let supabaseAdmin; let geminiModel; let bot;
    try {
        // ... инициализация клиентов и bot.init() ...
        console.log("[Bot] Initializing clients...");
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { /* ... */ } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        bot = new Bot(BOT_TOKEN);
        await bot.init();
        console.log("[Bot] Clients initialized.");
    } catch (initError) { /* ... обработка ошибок инициализации ... */ }

    // --- 3. Настройка обработчиков ---
    console.log("[Bot] Setting up bot handlers...");

    bot.command("start", async (ctx) => {
        console.log("[Bot:Handler /start] Received /start command."); // <<< ЛОГ СТАРТА
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot:Handler /start] No user ID found."); return; }
        console.log(`[Bot:Handler /start] User ${userId} started bot.`);
        try {
            await getOrCreateUser(supabaseAdmin, userId);
            await ctx.reply( /* ... текст приветствия ... */, { /* ... reply_markup ... */ }).catch(logReplyError);
             console.log(`[Bot:Handler /start] Welcome message sent to ${userId}.`);
        } catch (e) { console.error("[Bot:Handler /start] Error:", e); await ctx.reply("Ошибка инициализации.").catch(logReplyError); }
    });

    bot.on("message:text", async (ctx) => {
         console.log("[Bot:Handler text] Received text message."); // <<< ЛОГ ТЕКСТА
         const dreamText = ctx.message.text; const userId = ctx.from?.id; if (!userId) return;
         if (dreamText.startsWith('/')) { console.log(`[Bot:Handler text] Ignoring command: ${dreamText}`); return; }
         console.log(`[Bot:Handler text] Processing dream text from ${userId}`);
         await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText);
    });

    bot.on('pre_checkout_query', async (ctx) => {
        // <<< ЛОГ В САМОМ НАЧАЛЕ ---
        console.log("[Bot:Handler pre_checkout_query] Received PreCheckoutQuery:", JSON.stringify(ctx.preCheckoutQuery));
        const query = ctx.preCheckoutQuery;
        try {
            await ctx.answerPreCheckoutQuery(true);
            console.log("[Bot:Handler pre_checkout_query] Answered TRUE.");
        } catch (error) {
             console.error("[Bot:Handler pre_checkout_query] Failed to answer:", error);
             try { await ctx.answerPreCheckoutQuery(false, "Ошибка обработки"); } catch (e) {}
        }
    });

    bot.on('message:successful_payment', async (ctx) => {
        // <<< ЛОГ В САМОМ НАЧАЛЕ ---
        console.log("[Bot:Handler successful_payment] Received SuccessfulPayment:", JSON.stringify(ctx.message.successful_payment));
        const payment = ctx.message.successful_payment;
        const userId = ctx.from.id;
        // ... остальная логика обработки платежа ...
        try {
            // ... найти пользователя, рассчитать дату, определить токены ...
             const { data: user, error: findError } = await supabaseAdmin.from('users').select('id, tokens, subscription_end').eq('tg_id', userId).single();
             if (findError || !user) { /* ... обработка ... */ return; }
             const now = new Date(); /* ... */ const newSubEndDate = new Date(/* ... */);
             let tokensToAdd = 0; if (plan === 'basic') {tokensToAdd = 15;} else if (plan === 'premium') {tokensToAdd = 30;}
             const currentTokens = user.tokens || 0; const newTokens = currentTokens + tokensToAdd;
            // ... обновление supabase ...
             const { error: updateError } = await supabaseAdmin.from('users').update({ subscription_type: plan, subscription_end: newSubEndDate.toISOString(), tokens: newTokens }).eq('id', user.id);
             if (updateError) throw updateError;
             // ... отправка сообщения пользователю ...
             await ctx.reply(`Спасибо! Подписка ... Начислено ${tokensToAdd} токенов.`).catch(logReplyError);
        } catch (error) { /* ... обработка ошибки ... */ }
    });

    bot.catch((err) => { /* ... код без изменений ... */ });
    console.log("[Bot] Bot handlers configured.");

    // --- 4. Обработка обновления ---
    try {
        console.log("[Bot] Passing update to bot.handleUpdate...");
        await bot.handleUpdate(update);
        console.log("[Bot] bot.handleUpdate finished.");
        return { statusCode: 200, body: "" };
    } catch (error) { /* ... обработка ошибки handleUpdate ... */ }
};

console.log("[Bot] Netlify function bot.js (with payment handlers and extra logs) loaded.");
