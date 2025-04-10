// bot/functions/bot.js (Импорт webhookCallback из 'grammy')

const { Bot, Api, GrammyError, HttpError, webhookCallback } = require("grammy"); // <<<--- ИЗМЕНЕНО ЗДЕСЬ
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { webhookCallback } = require("@grammyjs/platform-netlify"); // <<<--- УДАЛЕНО ИЛИ ЗАКОММЕНТИРОВАНО

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
    console.error("[Bot Global Init] FATAL: Missing one or more environment variables!");
    throw new Error("Missing critical environment variables. Function cannot start.");
}

console.log("[Bot Global Init] Initializing clients and bot...");
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
let geminiModel;
const bot = new Bot(BOT_TOKEN);
console.log("[Bot Global Init] Basic bot instance created.");

async function getOrCreateUser(supabase, userId) {
    if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
        try {
            let { data: existingUser, error: selectError } = await supabase
                .from('users').select('id').eq('tg_id', userId).single();
            if (selectError && selectError.code !== 'PGRST116') throw selectError;
            if (existingUser) {
                 console.log(`[Bot:getOrCreateUser] Existing user found: ${userId}, ID: ${existingUser.id}`);
                 return existingUser.id;
            } else {
                 console.log(`[Bot:getOrCreateUser] User ${userId} not found. Creating new user...`);
                const { data: newUser, error: insertError } = await supabase
                    .from('users').insert({ tg_id: userId }).select('id').single();
                if (insertError) throw insertError;
                if (!newUser) throw new Error("User creation returned no data.");
                console.log(`[Bot:getOrCreateUser] Created new user: tg_id=${userId}, id=${newUser.id}`);
                return newUser.id;
            }
        } catch (error) {
            console.error(`[Bot:getOrCreateUser] CRITICAL error for ${userId}:`, error.message);
            throw new Error(`Failed to get or create user: ${error.message}`);
        }
}

async function getGeminiAnalysis(dreamText) {
     if (!geminiModel) {
         try {
             console.log("[getGeminiAnalysis] Initializing Gemini model...");
             geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
             console.log("[getGeminiAnalysis] Gemini model initialized.");
         } catch (initErr) {
              console.error("[getGeminiAnalysis] Failed to initialize Gemini model:", initErr);
              return "Ошибка: Не удалось инициализировать сервис анализа.";
         }
     }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;
    try {
        console.log("[Bot] Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        if (response.promptFeedback?.blockReason) {
             console.warn(`[Bot] Gemini blocked: ${response.promptFeedback.blockReason}`);
             return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}).`;
        }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) {
             console.error("[Bot] Gemini returned empty response.");
             return "К сожалению, не удалось получить анализ (пустой ответ).";
        }
        console.log("[Bot] Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("[Bot] Error explicitly caught in getGeminiAnalysis:", error);
        if (error.message?.includes("API key not valid")) {
            return "Ошибка: Неверный ключ API.";
        } else if (error.status === 404 || error.message?.includes("404") || error.message?.includes("is not found")) {
            return "Ошибка: Модель анализа не найдена.";
        }
        return "Ошибка при связи с сервисом анализа.";
    }
}

async function analyzeDream(ctx, supabase, dreamText) {
     const userId = ctx.from?.id;
     if (!userId) {
        await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError);
        return;
     }
     let userDbId;
     let processingMessage;
     try {
        userDbId = await getOrCreateUser(supabase, userId);
        if (!userDbId) {
            await ctx.reply("Ошибка доступа к профилю.").catch(logReplyError);
            return;
        }
        processingMessage = await ctx.reply("Проверяем токены...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabase
            .rpc('decrement_token_if_available', { user_tg_id: userId });

        if (rpcError) {
             console.error(`[Bot:analyzeDream] RPC error for tg_id ${userId}:`, rpcError);
             throw new Error("Внутренняя ошибка токенов.");
        }
        if (!tokenDecremented) {
            console.log(`[Bot:analyzeDream] Not enough tokens for ${userId}.`);
            if (processingMessage) await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {});
            await ctx.reply("Закончились токены.", { reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "ЛК", web_app: { url: TMA_URL } }]] } : undefined }).catch(logReplyError);
            return;
        }
        console.log(`[Bot:analyzeDream] Token decremented for ${userId}.`);
        if (processingMessage) {
             await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую... 🧠✨").catch(logReplyError);
        } else {
             await ctx.reply("Токен использован. Анализирую... 🧠✨").catch(logReplyError);
        }
        const analysisResult = await getGeminiAnalysis(dreamText);
        if (processingMessage) {
             await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {});
             processingMessage = null;
        }
        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) {
             await ctx.reply(analysisResult || "Неизвестная ошибка анализа.").catch(logReplyError);
             console.warn(`[Bot] Analysis failed for ${userId}, token consumed.`);
             return;
        }
        const { error: insertError } = await supabase
             .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) {
             console.error(`[Bot] Error saving analysis for ${userDbId}:`, insertError);
             await ctx.reply("Анализ готов, но ошибка сохранения:\n\n" + analysisResult).catch(logReplyError);
             return;
        }
        console.log(`[Bot] Analysis successful for ${userId}.`);
        await ctx.reply(`Анализ сна:\n\n${analysisResult}\n\nТокен списан. История в ЛК.`, { reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть ЛК", web_app: { url: TMA_URL } }]] } : undefined }).catch(logReplyError);
    } catch (error) {
        console.error(`[Bot] Critical error in analyzeDream for ${userId}:`, error.message);
        if (processingMessage) {
             await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {});
        }
        await ctx.reply(`Ошибка обработки: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
    }
}

function logReplyError(error) {
    console.error("[Bot] Failed to send message to Telegram:", error);
}

console.log("[Bot Global Init] Setting up handlers...");

bot.command("start", async (ctx) => {
    console.log("[Bot Handler /start] Command received.");
    const userId = ctx.from?.id;
    if (!userId) {
        console.warn("[Bot Handler /start] No user ID.");
        return;
    }
    console.log(`[Bot Handler /start] User ${userId}`);
    try {
        await getOrCreateUser(supabaseAdmin, userId);
        console.log(`[Bot Handler /start] Ensured user ${userId} exists.`);

        const welcomeMessage = "Привет! 👋 Это бот, который поможет разгадать тайные смыслы твоих снов.\n\nПолучи свой первый бесплатный токен в приложении и проанализируй сон!";
        const buttonUrl = `${TMA_URL}?action=claim_reward`;

        await ctx.reply(welcomeMessage, {
            reply_markup: {
                inline_keyboard: [[{
                    text: "🎁 Получить токен",
                    web_app: { url: buttonUrl }
                }]]
            }
        }).catch(logReplyError);
         console.log(`[Bot Handler /start] Welcome message sent to ${userId}.`);

    } catch (e) {
        console.error("[Bot Handler /start] Error:", e);
        try {
            await ctx.reply("Произошла ошибка при запуске. Попробуйте /start еще раз.").catch(logReplyError);
        } catch {}
    }
});

bot.on("message:text", async (ctx) => {
     console.log("[Bot Handler text] Received text message.");
     const dreamText = ctx.message.text;
     const userId = ctx.from?.id;
     if (!userId) return;
     if (dreamText.startsWith('/')) {
         console.log(`[Bot Handler text] Ignoring command: ${dreamText}`);
         return;
     }
     console.log(`[Bot Handler text] Processing dream for ${userId}`);
     await analyzeDream(ctx, supabaseAdmin, dreamText);
});

bot.on('pre_checkout_query', async (ctx) => {
    console.log("[Bot:Handler pre_checkout_query] Received:", JSON.stringify(ctx.preCheckoutQuery));
    try {
        await ctx.answerPreCheckoutQuery(true);
        console.log("[Bot:Handler pre_checkout_query] Answered TRUE.");
    } catch (error) {
        console.error("[Bot:Handler pre_checkout_query] Failed to answer:", error);
        try { await ctx.answerPreCheckoutQuery(false, "Error"); } catch (e) {}
    }
});

bot.on('message:successful_payment', async (ctx) => {
    console.log("[Bot:Handler successful_payment] Received:", JSON.stringify(ctx.message.successful_payment));
    const payment = ctx.message.successful_payment;
    const userId = ctx.from.id;
    const payload = payment.invoice_payload;
    const parts = payload.split('_');
    if (parts.length < 4 || parts[0] !== 'sub') {
        console.error(`[Bot] Invalid payload: ${payload}`);
        return;
    }
    const plan = parts[1];
    const durationMonths = parseInt(parts[2].replace('mo', ''), 10);
    const payloadUserId = parseInt(parts[3], 10);
    if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) {
        console.error(`[Bot] Payload error/mismatch: ${payload}, sender=${userId}`);
        return;
    }
    console.log(`[Bot] Processing payment for ${userId}: Plan=${plan}, Duration=${durationMonths}m.`);
    try {
        if (!supabaseAdmin) { throw new Error("Supabase unavailable"); }
        const { data: user, error: findError } = await supabaseAdmin.from('users').select('id, tokens, subscription_end').eq('tg_id', userId).single();
        if (findError || !user) {
             console.error(`[Bot] User ${userId} not found for payment!`);
             await ctx.reply("Платеж получен, но ошибка профиля.").catch(logReplyError);
             return;
        }
        const now = new Date();
        let currentSubEnd = user.subscription_end ? new Date(user.subscription_end) : now;
        if (currentSubEnd < now) currentSubEnd = now;
        const newSubEndDate = new Date(currentSubEnd.setMonth(currentSubEnd.getMonth() + durationMonths));
        let tokensToAdd = 0;
        if (plan === 'basic') tokensToAdd = 15; else if (plan === 'premium') tokensToAdd = 30;
        const currentTokens = user.tokens || 0;
        const newTokens = currentTokens + tokensToAdd;
        console.log(`[Bot] Updating tokens for ${userId}: Current=${currentTokens}, Add=${tokensToAdd}, New=${newTokens}`);
        const { error: updateError } = await supabaseAdmin.from('users').update({ subscription_type: plan, subscription_end: newSubEndDate.toISOString(), tokens: newTokens }).eq('id', user.id);
        if (updateError) {
             console.error(`[Bot] DB update failed for ${userId}:`, updateError);
             throw new Error("DB update failed");
        }
        console.log(`[Bot] User ${userId} updated: Plan=${plan}, Ends=${newSubEndDate.toISOString()}, Tokens=${newTokens}`);
        await ctx.reply(`Спасибо! Подписка "${plan.toUpperCase()}" активна до ${newSubEndDate.toLocaleDateString()}. ${tokensToAdd > 0 ? `Начислено ${tokensToAdd} токенов.` : ''}`).catch(logReplyError);
    } catch (error) {
        console.error(`[Bot] Failed process payment for ${userId}:`, error);
        await ctx.reply("Платеж получен, но ошибка обновления.").catch(logReplyError);
    }
});

bot.catch((err) => {
    const ctx = err.ctx;
    const e = err.error;
    console.error(`[Bot Global Error Handler] Error for update ${ctx.update.update_id}:`);
    if (e instanceof GrammyError) {
        console.error("GrammyError:", e.description, e.payload ? JSON.stringify(e.payload) : '');
    } else if (e instanceof HttpError) {
        console.error("HttpError:", e);
    } else {
        console.error("Unknown error:", e);
    }
});

console.log("[Bot Global Init] Handlers configured successfully.");

exports.handler = webhookCallback(bot, "http");

console.log("[Bot Global Init] Netlify handler exported using webhookCallback.");
