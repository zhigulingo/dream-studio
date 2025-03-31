// bot/functions/bot.js

// --- Импорты ---
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

// --- Вспомогательные Функции ---

async function getOrCreateUser(supabase, userId) {
    // ... (код без изменений) ...
    if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
    try {
        let { data: existingUser, error: selectError } = await supabase
            .from('users').select('id').eq('tg_id', userId).single();
        if (selectError && selectError.code !== 'PGRST116') throw selectError;
        if (existingUser) return existingUser.id;
        else {
            const { data: newUser, error: insertError } = await supabase
                .from('users').insert({ tg_id: userId, subscription_type: 'free', tokens: 1 }).select('id').single();
            if (insertError) throw insertError;
            if (!newUser) throw new Error("User creation returned no data.");
            console.log(`[Bot] Created new user: tg_id=${userId}, id=${newUser.id}`);
            return newUser.id;
        }
    } catch (error) { console.error(`[Bot] Error in getOrCreateUser for ${userId}:`, error.message); return null; }
}

async function getGeminiAnalysis(geminiModel, dreamText) {
    // ... (код без изменений) ...
    if (!geminiModel) { console.error("[Bot] Gemini model is null or undefined in getGeminiAnalysis."); return "Ошибка: Сервис анализа не инициализирован."; }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;
    try {
        console.log("[Bot] Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов...`; // Полный промпт
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        if (response.promptFeedback?.blockReason) { /* ... обработка ... */ }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) { /* ... обработка ... */ }
        console.log("[Bot] Gemini analysis received successfully.");
        return analysisText;
    } catch (error) { /* ... обработка ... */ }
}

async function analyzeDream(ctx, supabase, geminiModel, dreamText) {
    // <<<--- УБРАЛИ проверку на premium, теперь всегда списываем ---
    const userId = ctx.from?.id;
    if (!userId) { await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError); return; }
    let userDbId; let processingMessage;
    try {
        // Просто получаем ID, проверку токенов делает RPC
        userDbId = await getOrCreateUser(supabase, userId);
        if (!userDbId) { await ctx.reply("Ошибка доступа к профилю.").catch(logReplyError); return; }

        // Всегда проверяем и списываем токен через RPC
        processingMessage = await ctx.reply("Проверяем наличие токенов...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabaseAdmin // Используем Admin клиент для RPC
            .rpc('decrement_token_if_available', { user_tg_id: userId }); // Передаем tg_id

        if (rpcError) {
             console.error(`[Bot:analyzeDream] RPC error decrement_token for tg_id ${userId}:`, rpcError);
             await ctx.reply("Внутренняя ошибка при проверке токенов.").catch(logReplyError);
             if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); } // Удаляем статус
             return;
        }
        if (!tokenDecremented) {
            console.log(`[Bot:analyzeDream] Not enough tokens for user tg_id ${userId}.`);
             if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); } // Удаляем статус
            await ctx.reply("У вас закончились токены для анализа. Пополните баланс в Личном кабинете.", { /* ... reply_markup ... */ }).catch(logReplyError);
            return;
        }

        // Токен списан, продолжаем
        console.log(`[Bot:analyzeDream] Token decremented for tg_id ${userId}.`);
        if (processingMessage) { await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError); }
        else { await ctx.reply("Токен использован. Анализирую ваш сон... 🧠✨").catch(logReplyError); } // Если вдруг edit упал

        // Вызываем Gemini
        const analysisResult = await getGeminiAnalysis(geminiModel, dreamText);

        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => console.warn("[Bot] Could not delete status message:", e)); processingMessage = null; }

        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) { /* ... обработка ошибки Gemini ... */ await ctx.reply(analysisResult || "Произошла неизвестная ошибка анализа.").catch(logReplyError); console.warn(`[Bot] Analysis failed for ${userId}, token consumed.`); return; }

        // Сохраняем анализ
        const { error: insertError } = await supabaseAdmin // Используем Admin клиент
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) { /* ... обработка ошибки сохранения ... */ await ctx.reply("Сон проанализирован, но не удалось сохранить. Вот результат:\n\n" + analysisResult).catch(logReplyError); await ctx.reply("Проверить токены можно в ЛК.").catch(logReplyError); return; }

        console.log(`[Bot] Analysis for ${userId} successful.`);
        // Сообщаем об успехе и списании
        await ctx.reply(`Вот анализ вашего сна:\n\n${analysisResult}\n\nАнализ сохранен. Токен списан. История доступна в Личном кабинете.`, { /* ... reply_markup ... */ }).catch(logReplyError);

    } catch (error) {
        console.error(`[Bot] Critical error in analyzeDream for ${userId}:`, error);
         if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); }
        await ctx.reply("Произошла непредвиденная ошибка при обработке сна.").catch(logReplyError);
    }
}

function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Bot] Handler invoked.");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) { /* ... проверка ... */ }
    if (!event.body) { /* ... проверка ... */ }
    let update; try { update = JSON.parse(event.body); } catch (e) { /* ... проверка ... */ }

    let supabaseAdmin; // <<<--- Переименовали для ясности, что это Admin клиент
    let geminiModel;
    let bot;
    try {
        console.log("[Bot] Initializing clients inside handler...");
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }); // Используем Service Key
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const modelName = "gemini-2.0-flash";
        geminiModel = genAI.getGenerativeModel({ model: modelName });
        console.log(`[Bot] Using Gemini model: ${modelName}`);
        bot = new Bot(BOT_TOKEN);
        console.log("[Bot] Bot instance created. Calling bot.init()...");
        await bot.init();
        console.log("[Bot] bot.init() successful.");
    } catch (initError) { /* ... обработка ошибок инициализации ... */ }

    // --- 3. Настройка обработчиков ---
    console.log("[Bot] Setting up bot handlers...");
    bot.command("start", async (ctx) => { /* ... */ await getOrCreateUser(supabaseAdmin, ctx.from.id); /* ... */ }); // Передаем admin клиент
    bot.on("message:text", async (ctx) => { /* ... */ await analyzeDream(ctx, supabaseAdmin, geminiModel, ctx.message.text); /* ... */ }); // Передаем admin клиент

    // --- Обработчики Платежей ---
    bot.on('pre_checkout_query', async (ctx) => { /* ... код без изменений ... */ });

    bot.on('message:successful_payment', async (ctx) => {
        const payment = ctx.message.successful_payment;
        const userId = ctx.from.id;
        console.log(`[Bot] Received SuccessfulPayment from ${userId}. Amount: ${payment.total_amount} ${payment.currency}. Payload: ${payment.invoice_payload}`);
        const payload = payment.invoice_payload;
        const parts = payload.split('_');

        if (parts.length < 4 || parts[0] !== 'sub') { console.error(`[Bot] Invalid payload: ${payload}`); return; }
        const plan = parts[1];
        const durationMonths = parseInt(parts[2].replace('mo', ''), 10);
        const payloadUserId = parseInt(parts[3], 10);
        if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) { console.error(`[Bot] Payload error or user mismatch: payload=${payload}, userId=${userId}`); return; }

        console.log(`[Bot] Processing payment for user ${userId}: Plan=${plan}, Duration=${durationMonths} months.`);

        try {
            if (!supabaseAdmin) { throw new Error("Supabase client unavailable"); }

            // Найти пользователя и его текущие токены
            const { data: user, error: findError } = await supabaseAdmin
                .from('users')
                .select('id, tokens, subscription_end') // <<<--- Запрашиваем токены
                .eq('tg_id', userId)
                .single();

            if (findError || !user) { /* ... обработка ошибки поиска ... */ await ctx.reply("Платеж получен, но ошибка профиля.").catch(logReplyError); return; }

            // Рассчитать новую дату окончания подписки
            const now = new Date();
            let currentSubEnd = user.subscription_end ? new Date(user.subscription_end) : now;
            if (currentSubEnd < now) { currentSubEnd = now; }
            const newSubEndDate = new Date(currentSubEnd.setMonth(currentSubEnd.getMonth() + durationMonths));

            // <<<--- НОВАЯ ЛОГИКА НАЧИСЛЕНИЯ ТОКЕНОВ ---
            let tokensToAdd = 0;
            if (plan === 'basic') {
                tokensToAdd = 15;
            } else if (plan === 'premium') {
                tokensToAdd = 30;
            }
            const currentTokens = user.tokens || 0; // Берём текущие или 0, если null
            const newTokens = currentTokens + tokensToAdd;
            console.log(`[Bot] Updating tokens for user ${userId}: Current=${currentTokens}, Add=${tokensToAdd}, New=${newTokens}`);
            // --- КОНЕЦ НОВОЙ ЛОГИКИ ---

            // Обновляем запись пользователя
             const { error: updateError } = await supabaseAdmin
                 .from('users')
                 .update({
                     subscription_type: plan,
                     subscription_end: newSubEndDate.toISOString(),
                     tokens: newTokens // <<<--- Обновляем токены
                 })
                 .eq('id', user.id);

            if (updateError) { console.error(`[Bot] Failed DB update for user ${userId}:`, updateError); throw new Error("Database update failed"); }

            console.log(`[Bot] User ${userId} updated: Plan=${plan}, Ends=${newSubEndDate.toISOString()}, Tokens=${newTokens}`);
            await ctx.reply(`Спасибо! Подписка "${plan.toUpperCase()}" активна до ${newSubEndDate.toLocaleDateString()}. ${tokensToAdd > 0 ? `Начислено ${tokensToAdd} токенов.` : ''}`).catch(logReplyError);

        } catch (error) { /* ... обработка общей ошибки ... */ await ctx.reply("Платеж получен, но ошибка обновления подписки.").catch(logReplyError); }
    });
    // --- КОНЕЦ ОБРАБОТЧИКОВ ПЛАТЕЖЕЙ ---

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

console.log("[Bot] Netlify function bot.js (with token accrual logic) loaded.");
