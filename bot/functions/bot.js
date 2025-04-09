// bot/functions/bot.js (Исправлено: новые юзеры получают 0 токенов)

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
const TMA_URL = process.env.TMA_URL; // Базовый URL для TMA

// --- Вспомогательные Функции ---

// Функция получения/создания пользователя (ИСПРАВЛЕНО)
async function getOrCreateUser(supabase, userId) {
    if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
    try {
        // 1. Пытаемся найти пользователя
        let { data: existingUser, error: selectError } = await supabase
            .from('users')
            .select('id, tokens') // Выбираем и ID, и токены для лога
            .eq('tg_id', userId)
            .single();

        // Если ошибка, но это не "не найдено" (PGRST116), то выбрасываем ее
        if (selectError && selectError.code !== 'PGRST116') {
            console.error(`[Bot:getOrCreateUser] Error selecting user ${userId}:`, selectError);
            throw selectError;
        }

        // Если пользователь найден, возвращаем его ID
        if (existingUser) {
            console.log(`[Bot:getOrCreateUser] Existing user found: tg_id=${userId}, id=${existingUser.id}, tokens=${existingUser.tokens}`);
            return existingUser.id;
        }
        // Если пользователь не найден (selectError.code === 'PGRST116' или !existingUser)
        else {
            console.log(`[Bot:getOrCreateUser] User ${userId} not found. Creating...`);
            // 2. Создаем нового пользователя с 0 токенами
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({
                    tg_id: userId,
                    subscription_type: 'free',
                    tokens: 0, // <<<--- ИСПРАВЛЕНО: Начинаем с 0 токенов
                    channel_reward_claimed: false // Убедимся, что флаг тоже false
                })
                .select('id') // Возвращаем только ID нового пользователя
                .single(); // Ожидаем одну созданную строку

            // Если ошибка при вставке
            if (insertError) {
                console.error(`[Bot:getOrCreateUser] Error inserting new user ${userId}:`, insertError);
                // Проверяем на случай гонки запросов (вдруг кто-то создал юзера между SELECT и INSERT)
                if (insertError.code === '23505') { // Unique constraint violation
                     console.warn(`[Bot:getOrCreateUser] Race condition likely for user ${userId}. Trying to fetch again.`);
                     // Повторно ищем пользователя
                     let { data: raceUser, error: raceError } = await supabase.from('users').select('id').eq('tg_id', userId).single();
                     if (raceError) throw raceError; // Если и тут ошибка, то проблема серьезнее
                     if (raceUser) return raceUser.id; // Вернуть ID пользователя, созданного другим запросом
                }
                throw insertError; // Если другая ошибка вставки, выбрасываем ее
            }

            // Если вставка прошла успешно, но данные не вернулись (маловероятно)
            if (!newUser) {
                throw new Error("User creation successful but returned no data.");
            }

            console.log(`[Bot:getOrCreateUser] Created new user: tg_id=${userId}, id=${newUser.id}, initial tokens=0`);
            return newUser.id;
        }
    } catch (error) {
        // Общий обработчик ошибок для getOrCreateUser
        console.error(`[Bot:getOrCreateUser] Critical error for user ${userId}:`, error.message);
        return null; // Возвращаем null, чтобы вызывающая функция знала об ошибке
    }
}


// Функция анализа сна (БЕЗ ИЗМЕНЕНИЙ)
async function getGeminiAnalysis(geminiModel, dreamText) {
    if (!geminiModel) { console.error("[Bot] Gemini model is null or undefined in getGeminiAnalysis."); return "Ошибка: Сервис анализа не инициализирован."; }
    const MAX_DREAM_LENGTH = 4000;
    if (!dreamText || dreamText.trim().length === 0) return "Пожалуйста, опишите свой сон.";
    if (dreamText.length > MAX_DREAM_LENGTH) return `Сон слишком длинный (>${MAX_DREAM_LENGTH} символов). Попробуйте короче.`;
    try {
        console.log("[Bot] Requesting Gemini analysis...");
        const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        if (response.promptFeedback?.blockReason) { console.warn(`[Bot] Gemini blocked: ${response.promptFeedback.blockReason}`); return `Анализ не выполнен из-за ограничений безопасности (${response.promptFeedback.blockReason}).`; }
        const analysisText = response.text();
        if (!analysisText || analysisText.trim().length === 0) { console.error("[Bot] Gemini returned empty response."); return "К сожалению, не удалось получить анализ (пустой ответ)."; }
        console.log("[Bot] Gemini analysis received successfully.");
        return analysisText;
    } catch (error) {
        console.error("[Bot] Error explicitly caught in getGeminiAnalysis:", error);
         if (error.message?.includes("API key not valid")) { return "Ошибка: Неверный ключ API."; }
         else if (error.status === 404 || error.message?.includes("404") || error.message?.includes("is not found")) { return "Ошибка: Модель анализа не найдена."; }
        return "Ошибка при связи с сервисом анализа.";
    }
}

// Функция обработки запроса анализа (БЕЗ ИЗМЕНЕНИЙ)
async function analyzeDream(ctx, supabase, geminiModel, dreamText) {
    const userId = ctx.from?.id;
    if (!userId) { await ctx.reply("Не удалось идентифицировать пользователя.").catch(logReplyError); return; }
    let userDbId; let processingMessage;
    try {
        userDbId = await getOrCreateUser(supabase, userId); // Используем обновленную функцию
        if (!userDbId) { await ctx.reply("Ошибка доступа к профилю.").catch(logReplyError); return; }
        processingMessage = await ctx.reply("Проверяем токены...").catch(logReplyError);
        const { data: tokenDecremented, error: rpcError } = await supabase
            .rpc('decrement_token_if_available', { user_tg_id: userId }); // Используем tg_id

        if (rpcError) { console.error(`[Bot:analyzeDream] RPC error for tg_id ${userId}:`, rpcError); throw new Error("Внутренняя ошибка токенов.");}
        if (!tokenDecremented) {
             console.log(`[Bot:analyzeDream] Not enough tokens for ${userId}.`);
             if (processingMessage) await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {});
             // --- Улучшенное сообщение о нехватке токенов ---
             const noTokensMessage = "Закончились токены для анализа 😟\n\nВы можете получить один бесплатный токен за подписку на канал или приобрести подписку.";
             const buttons = [];
             // Добавляем кнопку получения награды, если есть TMA_URL
             if (TMA_URL) {
                 buttons.push([{ text: "🎁 Получить бесплатный токен", web_app: { url: `${TMA_URL}?action=claim_reward` } }]);
             }
              // Добавляем кнопку ЛК/Подписки, если есть TMA_URL
             if (TMA_URL) {
                  buttons.push([{ text: "🛒 Приобрести подписку", web_app: { url: TMA_URL } }]);
             }
             await ctx.reply(noTokensMessage, { reply_markup: { inline_keyboard: buttons } }).catch(logReplyError);
             return;
        }

        console.log(`[Bot:analyzeDream] Token decremented for ${userId}.`);
        if (processingMessage) { await ctx.api.editMessageText(ctx.chat.id, processingMessage.message_id, "Токен использован. Анализирую... 🧠✨").catch(logReplyError); }
        else { await ctx.reply("Токен использован. Анализирую... 🧠✨").catch(logReplyError); }

        const analysisResult = await getGeminiAnalysis(geminiModel, dreamText);
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); processingMessage = null; }

        const isErrorResult = typeof analysisResult !== 'string' || ["Пожалуйста,", "Извините,", "К сожалению,", "Ошибка:", "Анализ не выполнен"].some(prefix => analysisResult.startsWith(prefix));
        if (isErrorResult) { await ctx.reply(analysisResult || "Неизвестная ошибка анализа.").catch(logReplyError); console.warn(`[Bot] Analysis failed for ${userId}, token consumed.`); return; }

        const { error: insertError } = await supabase
            .from('analyses').insert({ user_id: userDbId, dream_text: dreamText, analysis: analysisResult });
        if (insertError) { console.error(`[Bot] Error saving analysis for ${userDbId}:`, insertError); await ctx.reply("Анализ готов, но ошибка сохранения:\n\n" + analysisResult).catch(logReplyError); return; }

        console.log(`[Bot] Analysis successful for ${userId}.`);
        await ctx.reply(`Анализ сна:\n\n${analysisResult}\n\nТокен списан. История в ЛК.`, { reply_markup: TMA_URL ? { inline_keyboard: [[{ text: "Открыть ЛК", web_app: { url: TMA_URL } }]] } : undefined }).catch(logReplyError);

    } catch (error) {
        console.error(`[Bot] Critical error in analyzeDream for ${userId}:`, error.message);
        if (processingMessage) { await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id).catch(e => {}); }
        await ctx.reply(`Ошибка обработки: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
    }
}

// Функция логирования ошибок отправки (БЕЗ ИЗМЕНЕНИЙ)
function logReplyError(error) { console.error("[Bot] Failed to send message to Telegram:", error); }

// --- Главный Обработчик Netlify Function ---
exports.handler = async (event) => {
    console.log("[Bot] Handler invoked.");
    // --- Проверяем наличие TMA_URL ---
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
         console.error("[Bot] FATAL: Missing env vars (BOT_TOKEN, SUPABASE_*, GEMINI_API_KEY, TMA_URL)!");
         return { statusCode: 500, body: "Config missing." };
    }
    if (!event.body) { console.warn("[Bot] Empty event body."); return { statusCode: 400, body: "Bad Request" }; }
    let update; try { update = JSON.parse(event.body); } catch (e) { console.error("[Bot] Invalid JSON body:", e); return { statusCode: 400, body: "Invalid JSON" }; }

    let supabaseAdmin; let geminiModel; let bot;
    try {
        console.log("[Bot] Initializing clients...");
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Убедитесь, что модель актуальна
        bot = new Bot(BOT_TOKEN);
        // Не нужно bot.init() при обработке вебхука, grammY сделает это сам
        // await bot.init();
        console.log("[Bot] Clients initialized.");
    } catch (initError) { console.error("[Bot] FATAL: Client init failed:", initError); return { statusCode: 500, body: "Init failed." }; }

    // --- Настройка Обработчиков ---
    console.log("[Bot] Setting up handlers...");

    // Обработчик /start (ИСПРАВЛЕНО)
    bot.command("start", async (ctx) => {
        console.log("[Bot:Handler /start] Received /start command.");
        const userId = ctx.from?.id;
        if (!userId) { console.warn("[Bot:Handler /start] No user ID."); return; }
        console.log(`[Bot:Handler /start] User ${userId}`);

        try {
            // 1. Убеждаемся, что пользователь существует (создастся с 0 токенами, если новый)
            await getOrCreateUser(supabaseAdmin, userId);
            console.log(`[Bot:Handler /start] Ensured user ${userId} exists.`);

            // 2. Отправляем приветственное сообщение с кнопкой для ПОЛУЧЕНИЯ токена в TMA
            const welcomeMessage = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой **первый бесплатный токен** за подписку на канал!";
            // URL ведет в TMA и содержит параметр, чтобы TMA знало, что показать
            const buttonUrl = `${TMA_URL}?action=claim_reward`;

            await ctx.replyWithMarkdown(welcomeMessage, { // Используем Markdown для **
                reply_markup: {
                    inline_keyboard: [[{
                        text: "🎁 Открыть приложение и получить токен",
                        web_app: { url: buttonUrl }
                    }]]
                }
            }).catch(logReplyError);

             console.log(`[Bot:Handler /start] Welcome & 'Get Token' button sent to ${userId}.`);

        } catch (e) {
            console.error("[Bot:Handler /start] Error ensuring user or sending message:", e);
            await ctx.reply("Произошла ошибка при запуске. Попробуйте команду /start еще раз.").catch(logReplyError);
        }
    });

    // Обработчик текстовых сообщений (БЕЗ ИЗМЕНЕНИЙ)
    bot.on("message:text", async (ctx) => {
         console.log("[Bot:Handler text] Received text message.");
         const dreamText = ctx.message.text; const userId = ctx.from?.id; if (!userId) return;
         // Игнорируем команды
         if (dreamText.startsWith('/')) { console.log(`[Bot:Handler text] Ignoring command: ${dreamText}`); return; }
         console.log(`[Bot:Handler text] Processing dream for ${userId}`);
         await analyzeDream(ctx, supabaseAdmin, geminiModel, dreamText);
    });

    // Обработчик pre_checkout_query (БЕЗ ИЗМЕНЕНИЙ)
    bot.on('pre_checkout_query', async (ctx) => {
        console.log("[Bot:Handler pre_checkout_query] Received:", JSON.stringify(ctx.preCheckoutQuery));
        try {
            await ctx.answerPreCheckoutQuery(true);
            console.log("[Bot:Handler pre_checkout_query] Answered TRUE.");
        } catch (error) { console.error("[Bot:Handler pre_checkout_query] Failed to answer:", error); try { await ctx.answerPreCheckoutQuery(false, "Internal error"); } catch (e) {} }
    });

    // Обработчик successful_payment (БЕЗ ИЗМЕНЕНИЙ)
    bot.on('message:successful_payment', async (ctx) => {
        console.log("[Bot:Handler successful_payment] Received:", JSON.stringify(ctx.message.successful_payment));
        const payment = ctx.message.successful_payment; const userId = ctx.from.id;
        // Убедимся, что invoice_payload существует
        const payload = payment.invoice_payload;
        if (!payload) { console.error(`[Bot] Missing invoice_payload in successful_payment from user ${userId}`); return; }

        const parts = payload.split('_');
        // Проверка формата payload (sub_plan_duration_tgUserId)
        if (parts.length < 4 || parts[0] !== 'sub') { console.error(`[Bot] Invalid payload format: ${payload} from user ${userId}`); return; }

        const plan = parts[1];
        const durationMonths = parseInt(parts[2].replace('mo', ''), 10);
        const payloadUserId = parseInt(parts[3], 10);

        // Проверка корректности данных из payload
        if (isNaN(durationMonths) || isNaN(payloadUserId) || payloadUserId !== userId) {
            console.error(`[Bot] Payload data error or mismatch: Payload=${payload}, Sender=${userId}`);
             // Можно уведомить пользователя о проблеме
             await ctx.reply("Получен платеж с некорректными данными. Свяжитесь с поддержкой, если средства списаны.").catch(logReplyError);
            return;
        }

        console.log(`[Bot] Processing payment for ${userId}: Plan=${plan}, Duration=${durationMonths}mo.`);
        try {
            if (!supabaseAdmin) { throw new Error("Supabase client unavailable"); } // Проверка на всякий случай

            // Используем транзакцию для надежности
            const { error: txError } = await supabaseAdmin.rpc('process_successful_payment', {
                user_tg_id: userId,
                plan_type: plan,
                duration_months: durationMonths
            });

            if (txError) {
                 console.error(`[Bot] Error calling process_successful_payment RPC for ${userId}:`, txError);
                 throw new Error("Database update failed during payment processing.");
            }

            // RPC сама вычислит дату и добавит токены
            console.log(`[Bot] Successfully processed payment via RPC for user ${userId}. Plan=${plan}, Duration=${durationMonths}mo`);
            await ctx.reply(`Спасибо! Ваша подписка "${plan.toUpperCase()}" успешно активирована/продлена. Токены начислены. Приятного анализа снов! ✨`).catch(logReplyError);

        } catch (error) {
            console.error(`[Bot] Failed to process payment for ${userId}:`, error);
            await ctx.reply("Ваш платеж получен, но произошла ошибка при обновлении подписки. Пожалуйста, свяжитесь с поддержкой.").catch(logReplyError);
        }
    });

    // Обработчик ошибок (БЕЗ ИЗМЕНЕНИЙ)
    bot.catch((err) => {
        const ctx = err.ctx; const e = err.error;
        console.error(`[Bot] Error caught by bot.catch for update ${ctx?.update?.update_id}:`);
        if (e instanceof GrammyError) console.error("GrammyError:", e.description, e.payload);
        else if (e instanceof HttpError) console.error("HttpError:", e);
        else if (e instanceof Error) console.error("Error:", e.stack || e.message); // Логируем стек для обычных ошибок
        else console.error("Unknown error object:", e);
    });

    console.log("[Bot] Handlers configured.");

    // --- Обработка обновления ---
    try {
        console.log("[Bot] Passing update to bot.handleUpdate...");
        // Используем рекомендуемый способ обработки вебхука для Netlify
        await bot.handleUpdate(update);
        console.log("[Bot] bot.handleUpdate finished.");
        return { statusCode: 200, body: "" };
    } catch (error) {
        // Эта ошибка маловероятна, т.к. bot.catch должен ловить ошибки обработки
        console.error("[Bot] Error during bot.handleUpdate call:", error);
        return { statusCode: 500, body: "Internal Server Error during update processing." };
    }
};

// --- КОНЕЦ ФАЙЛА bot.js ---
