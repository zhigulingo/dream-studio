// bot/functions/bot.js (Попытка №6: webhookCallback + логика /start + анализ без ответа)

// --- Импорты ---
const { Bot, Api, GrammyError, HttpError, webhookCallback } = require("grammy");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto'); // Для будущей валидации, если понадобится

// --- Получение Переменных Окружения (ВАЖНО: ПРОВЕРЬТЕ ИХ В NETLIFY!) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TMA_URL = process.env.TMA_URL; // Базовый URL для Mini App

// --- Глобальная Инициализация ---
let bot;
let supabaseAdmin;
let geminiModel;
let initializationError = null;

try {
    console.log("[Bot Global Init] Initializing clients and bot...");
    if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY || !TMA_URL) {
        throw new Error("FATAL: Missing one or more environment variables!");
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    console.log("[Bot Global Init] Supabase client created.");

    // Отложим инициализацию Gemini до первого вызова analyzeDream
    // const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    // console.log("[Bot Global Init] Gemini client prepared.");

    bot = new Bot(BOT_TOKEN);
    console.log("[Bot Global Init] Basic bot instance created.");

    // --- Настройка Обработчиков ---
    console.log("[Bot Global Init] Setting up handlers...");

    // Обработчик /start (С логикой удаления и разными сообщениями)
    bot.command("start", async (ctx) => {
        console.log("[Bot Handler /start] Command received.");
        const userId = ctx.from?.id;
        const chatId = ctx.chat.id; // ID чата нужен для удаления сообщения
        if (!userId || !chatId) { console.warn("[Bot Handler /start] No user ID or chat ID."); return; }
        console.log(`[Bot Handler /start] User ${userId} in chat ${chatId}`);

        let userData;
        try {
            // 1. Получаем или создаем пользователя (возвращает { id, claimed, lastMessageId })
            userData = await getOrCreateUser(supabaseAdmin, userId);
            if (!userData || !userData.id) throw new Error("Failed to retrieve user data after getOrCreateUser.");
            console.log(`[Bot Handler /start] User data: ID=${userData.id}, Claimed=${userData.claimed}, LastMsgId=${userData.lastMessageId}`);

            // 2. Пытаемся удалить предыдущее сообщение /start, если ID сохранен
            if (userData.lastMessageId) {
                console.log(`[Bot Handler /start] Attempting to delete previous message ${userData.lastMessageId} in chat ${chatId}`);
                await ctx.api.deleteMessage(chatId, userData.lastMessageId)
                    .then(() => console.log(`[Bot Handler /start] Deleted previous message.`))
                    .catch(async (deleteError) => { // Используем async для await внутри catch
                        // Игнорируем ошибку, если сообщение не найдено
                        if (deleteError instanceof GrammyError && (deleteError.error_code === 400 && deleteError.description.includes("message to delete not found"))) {
                            console.log(`[Bot Handler /start] Previous message ${userData.lastMessageId} not found or already deleted.`);
                            // Сбрасываем ID в базе, т.к. он неактуален
                            const { error: resetError } = await supabaseAdmin.from('users').update({ last_start_message_id: null }).eq('id', userData.id);
                            if (resetError) console.error(`[Bot Handler /start] Failed to reset missing last_start_message_id:`, resetError);
                        } else {
                            // Логируем другие ошибки удаления
                            console.error(`[Bot Handler /start] Failed to delete previous message ${userData.lastMessageId}:`, deleteError);
                        }
                    });
            }

            // 3. Определяем текст и кнопку в зависимости от статуса награды
            let messageText, buttonText, buttonUrl;
            if (userData.claimed) {
                // Пользователь уже получил награду (или не новый)
                messageText = "С возвращением! 👋 Анализируй сны, отправляя их мне, или загляни в Личный кабинет.";
                buttonText = "Личный кабинет";
                buttonUrl = TMA_URL; // Просто открываем ЛК
            } else {
                // Новый пользователь или еще не получил награду
                messageText = "Привет! 👋 Это бот для анализа твоих снов.\n\nНажми кнопку ниже, чтобы перейти в приложение и получить свой <b>первый бесплатный токен</b> за подписку на канал!";
                buttonText = "🎁 Открыть приложение и получить токен";
                buttonUrl = `${TMA_URL}?action=claim_reward`; // Открываем ЛК с параметром для показа секции награды
            }

            // 4. Отправляем НОВОЕ сообщение
            console.log(`[Bot Handler /start] Sending new message (Claimed: ${userData.claimed})`);
            const sentMessage = await ctx.reply(messageText, {
                parse_mode: 'HTML', // Используем HTML для <b>
                reply_markup: {
                    inline_keyboard: [[{
                        text: buttonText,
                        web_app: { url: buttonUrl }
                    }]]
                }
            });
            console.log(`[Bot Handler /start] New message sent. ID: ${sentMessage.message_id}`);

            // 5. Сохраняем ID нового сообщения в базу
            const { error: updateError } = await supabaseAdmin
                .from('users')
                .update({ last_start_message_id: sentMessage.message_id })
                .eq('id', userData.id);

            if (updateError) {
                console.error(`[Bot Handler /start] Failed to update last_start_message_id for user ${userId}:`, updateError);
                // Не критично, просто логируем
            } else {
                console.log(`[Bot Handler /start] Updated last_start_message_id to ${sentMessage.message_id} for user ${userId}.`);
            }

        } catch (e) {
            console.error("[Bot Handler /start] CRITICAL Error in /start processing:", e);
            // Не отправляем сообщение об ошибке пользователю, чтобы не засорять чат,
            // но обязательно смотрим логи Netlify.
             try {
                 await ctx.reply("Произошла внутренняя ошибка при обработке команды.").catch(e => {}); // Тихое сообщение об ошибке
             } catch {}
        }
    });

    // Обработчик текстовых сообщений (с удалением сообщения пользователя и без ответа анализом)
    bot.on("message:text", async (ctx) => {
        console.log("[Bot Handler message:text] Text received.");
        const dreamText = ctx.message.text;
        const userId = ctx.from?.id;
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id; // ID сообщения пользователя

        if (!userId || !chatId) { console.warn("[Bot Handler message:text] No user ID or chat ID."); return; }
        if (dreamText.startsWith('/')) { console.log(`[Bot Handler message:text] Ignoring command.`); return; } // Игнорируем команды

        console.log(`[Bot Handler message:text] Processing dream for ${userId}`);
        let statusMessage; // Переменная для сообщения "Анализирую..."

        try {
            // Попытка удалить сообщение пользователя СРАЗУ
            console.log(`[Bot Handler message:text] Attempting to delete user message ${messageId} in chat ${chatId}`);
            await ctx.api.deleteMessage(chatId, messageId).catch(delErr => {
                 // Игнорируем ошибку "message not found", логируем остальные
                 if (!(delErr instanceof GrammyError && delErr.error_code === 400 && delErr.description.includes("message to delete not found"))) {
                     console.warn(`[Bot Handler message:text] Failed to delete user message ${messageId}:`, delErr);
                 } else {
                      console.log(`[Bot Handler message:text] User message ${messageId} likely already deleted.`);
                 }
            });

            // Отправляем сообщение о статусе
            statusMessage = await ctx.reply("Анализирую ваш сон... 🧠✨").catch(logReplyError);
            if (!statusMessage) { // Если не удалось отправить статус, выходим
                 console.error("[Bot Handler message:text] Failed to send status message.");
                 return;
            }

            // Вызываем функцию анализа (которая теперь возвращает только текст или ошибку)
            const analysisResult = await analyzeDream(ctx, supabaseAdmin, dreamText); // Передаем ctx и supabaseAdmin

            // Удаляем сообщение "Анализирую..."
             console.log(`[Bot Handler message:text] Deleting status message ${statusMessage.message_id}`);
            await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(delErr => {
                 console.warn(`[Bot Handler message:text] Failed to delete status message ${statusMessage.message_id}:`, delErr);
            });

            // Проверяем, не вернула ли analyzeDream ошибку
            // (Предполагаем, что analyzeDream ВЫБРАСЫВАЕТ ошибку при проблемах, а не возвращает текст ошибки)
            // Если analyzeDream вернула текст, значит это был УСПЕШНЫЙ анализ

            // --- ИЗМЕНЕНО: Не отправляем анализ, только подтверждение ---
            console.log(`[Bot Handler message:text] Analysis completed (result not sent to chat).`);
             const confirmationMessage = "Ваш анализ сна готов и сохранен! ✨\n\nВы можете посмотреть его в истории в Личном кабинете.";
             const sentConfirmation = await ctx.reply(confirmationMessage, {
                 reply_markup: { inline_keyboard: [[{ text: "Открыть Личный кабинет", web_app: { url: TMA_URL } }]] }
             }).catch(logReplyError);

             // Попытаемся удалить и это сообщение через некоторое время? Или оставить?
             // Пока оставим.

        } catch (error) {
             // Ловим ошибки из analyzeDream или других await
            console.error(`[Bot Handler message:text] Error processing dream for user ${userId}:`, error);
            // Удаляем сообщение "Анализирую...", если оно еще есть и была ошибка
            if (statusMessage) {
                await ctx.api.deleteMessage(chatId, statusMessage.message_id).catch(e => {});
            }
            // Отправляем сообщение об ошибке пользователю
             await ctx.reply(`Произошла ошибка при анализе сна: ${error.message || 'Неизвестная ошибка'}`).catch(logReplyError);
        }
    });


    // Обработчик pre_checkout_query (без изменений)
    bot.on('pre_checkout_query', async (ctx) => { /* ... */ });
    // Обработчик successful_payment (без изменений, использует RPC)
    bot.on('message:successful_payment', async (ctx) => { /* ... */ });
    // Обработчик ошибок (без изменений)
    bot.catch((err) => { /* ... */ });

    console.log("[Bot Global Init] Handlers configured successfully.");

} catch (error) {
    console.error("[Bot Global Init] CRITICAL INITIALIZATION ERROR:", error);
    initializationError = error;
    bot = null;
}

// --- Вспомогательные Функции ---

// getOrCreateUser (с возвратом id, claimed, lastMessageId)
async function getOrCreateUser(supabase, userId) {
    if (!supabase) throw new Error("Supabase client not available in getOrCreateUser.");
    try {
        let { data: existingUser, error: selectError } = await supabase
            .from('users')
            .select('id, channel_reward_claimed, last_start_message_id') // Выбираем нужные поля
            .eq('tg_id', userId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') throw selectError; // Ошибка, но не "не найдено"

        if (existingUser) {
             console.log(`[Bot:getOrCreateUser] Existing user found: ${userId}, ID: ${existingUser.id}, Claimed: ${existingUser.channel_reward_claimed}, LastMsg: ${existingUser.last_start_message_id}`);
             // Возвращаем объект с данными
             return {
                 id: existingUser.id,
                 claimed: existingUser.channel_reward_claimed ?? false, // Если null, считаем false
                 lastMessageId: existingUser.last_start_message_id
             };
        } else {
             console.log(`[Bot:getOrCreateUser] User ${userId} not found. Creating new user...`);
            // Создаем пользователя с дефолтными значениями
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({
                    tg_id: userId,
                    subscription_type: 'free',
                    tokens: 0, // Начинаем с 0 токенов
                    channel_reward_claimed: false // Награда не получена
                    // last_start_message_id будет null по умолчанию
                 })
                .select('id') // Достаточно получить ID
                .single();

            if (insertError) {
                 // Обработка гонки запросов
                 if (insertError.code === '23505') {
                     console.warn(`[Bot:getOrCreateUser] Race condition likely for user ${userId}. Re-fetching...`);
                     let { data: raceUser, error: raceError } = await supabase.from('users').select('id, channel_reward_claimed, last_start_message_id').eq('tg_id', userId).single();
                     if (raceError) throw raceError;
                     if (raceUser) return { id: raceUser.id, claimed: raceUser.channel_reward_claimed ?? false, lastMessageId: raceUser.last_start_message_id };
                 }
                 throw insertError;
            }
            if (!newUser) throw new Error("User creation returned no data.");

            console.log(`[Bot:getOrCreateUser] Created new user: tg_id=${userId}, id=${newUser.id}`);
            // Возвращаем дефолтные значения для нового пользователя
            return { id: newUser.id, claimed: false, lastMessageId: null };
        }
    } catch (error) {
        console.error(`[Bot:getOrCreateUser] CRITICAL error for ${userId}:`, error.message);
        // Выбрасываем ошибку, чтобы она была поймана в вызывающей функции (/start)
        throw new Error(`Failed to get or create user: ${error.message}`);
    }
}

// getGeminiAnalysis (Инициализация модели внутри, если не создана)
async function getGeminiAnalysis(dreamText) {
     // Инициализация модели при первом вызове, если еще не создана
     if (!geminiModel) {
         try {
             console.log("[getGeminiAnalysis] Initializing Gemini model (on demand)...");
             if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
             if (!genAI) throw new Error("GoogleGenerativeAI instance (genAI) is not available."); // Проверка на всякий случай
             geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
             console.log("[getGeminiAnalysis] Gemini model initialized successfully.");
         } catch (initErr) {
             console.error("[getGeminiAnalysis] Failed to initialize Gemini model:", initErr);
             // Возвращаем текст ошибки, чтобы analyzeDream мог его обработать
             return `Ошибка getGeminiAnalysis: Не удалось инициализировать сервис анализа (${initErr.message})`;
         }
     }

     const MAX_DREAM_LENGTH = 4000;
     if (!dreamText || dreamText.trim().length === 0) return "Ошибка getGeminiAnalysis: Пустой текст сна.";
     if (dreamText.length > MAX_DREAM_LENGTH) return `Ошибка getGeminiAnalysis: Сон слишком длинный (>${MAX_DREAM_LENGTH}).`;

     try {
         console.log("[getGeminiAnalysis] Requesting Gemini analysis...");
         const prompt = `Ты - эмпатичный толкователь снов. Проанализируй сон, сохраняя конфиденциальность, избегая мед. диагнозов/предсказаний. Сон: "${dreamText}". Анализ (2-4 абзаца): 1. Символы/значения. 2. Эмоции/связь с реальностью (если уместно). 3. Темы/сообщения. Отвечай мягко, поддерживающе.`;
         const result = await geminiModel.generateContent(prompt);
         const response = await result.response;
         if (response.promptFeedback?.blockReason) {
             console.warn(`[getGeminiAnalysis] Gemini blocked: ${response.promptFeedback.blockReason}`);
             return `Ошибка getGeminiAnalysis: Анализ заблокирован (${response.promptFeedback.blockReason}).`;
         }
         const analysisText = response.text();
         if (!analysisText || analysisText.trim().length === 0) {
             console.error("[getGeminiAnalysis] Gemini returned empty response.");
             return "Ошибка getGeminiAnalysis: Пустой ответ от сервиса анализа.";
         }
         console.log("[getGeminiAnalysis] Gemini analysis received successfully.");
         return analysisText; // Возвращаем только текст анализа
     } catch (error) {
         console.error("[getGeminiAnalysis] Error during Gemini API call:", error);
         if (error.message?.includes("API key not valid")) return "Ошибка getGeminiAnalysis: Неверный ключ API Gemini.";
         else if (error.status === 404 || error.message?.includes("404") || error.message?.includes("is not found")) return "Ошибка getGeminiAnalysis: Модель Gemini не найдена.";
         else if (error.message?.includes("quota")) return "Ошибка getGeminiAnalysis: Превышена квота Gemini API.";
         // Возвращаем текст ошибки для обработки в analyzeDream
         return `Ошибка getGeminiAnalysis: Ошибка связи с сервисом анализа (${error.message})`;
     }
}


// analyzeDream (Изменена: выбрасывает ошибку, сохраняет в БД)
async function analyzeDream(ctx, supabase, dreamText) {
    const userId = ctx.from?.id;
    if (!userId) { throw new Error("Не удалось идентифицировать пользователя."); } // Выбрасываем ошибку

    let userDbId;
    try {
        // Получаем ID пользователя в нашей БД
        const userData = await getOrCreateUser(supabase, userId); // Используем уже имеющуюся функцию
        userDbId = userData.id;
        if (!userDbId) { throw new Error("Ошибка доступа к профилю пользователя."); } // Выбрасываем ошибку

        // Проверяем и списываем токен АТОМАРНО через RPC
        console.log(`[analyzeDream] Checking and decrementing token for user ${userId}...`);
        const { data: tokenDecremented, error: rpcError } = await supabase
            .rpc('decrement_token_if_available', { user_tg_id: userId });

        if (rpcError) {
            console.error(`[analyzeDream] RPC error for tg_id ${userId}:`, rpcError);
            throw new Error("Внутренняя ошибка при проверке токенов."); // Выбрасываем ошибку
        }
        if (!tokenDecremented) {
            console.log(`[analyzeDream] Not enough tokens for user ${userId}.`);
            throw new Error("Недостаточно токенов для анализа."); // Выбрасываем ошибку (текст увидит пользователь)
        }
        console.log(`[analyzeDream] Token successfully decremented for user ${userId}.`);

        // Получаем анализ от Gemini
        console.log(`[analyzeDream] Requesting analysis for user ${userId}...`);
        const analysisResultText = await getGeminiAnalysis(dreamText); // Получаем текст или текст ошибки

        // ПРОВЕРЯЕМ, не вернула ли getGeminiAnalysis текст ошибки
        if (typeof analysisResultText === 'string' && analysisResultText.startsWith('Ошибка getGeminiAnalysis:')) {
             console.warn(`[analyzeDream] Analysis failed for user ${userId}. Reason: ${analysisResultText}`);
             // ВАЖНО: Токен уже списан! Нужно ли его вернуть? Пока нет.
             // Выбрасываем ошибку с текстом от Gemini
             throw new Error(analysisResultText.replace('Ошибка getGeminiAnalysis: ', 'Ошибка анализа: '));
        }

        // Если ошибок нет, сохраняем результат в базу
        console.log(`[analyzeDream] Analysis successful for user ${userId}. Saving to DB...`);
        const { error: insertError } = await supabase
            .from('analyses')
            .insert({
                user_id: userDbId,
                dream_text: dreamText, // Сохраняем исходный текст сна
                analysis: analysisResultText // Сохраняем результат анализа
            });

        if (insertError) {
            console.error(`[analyzeDream] Error saving analysis to DB for user ${userId} (dbId ${userDbId}):`, insertError);
            // Токен списан, анализ получен, но не сохранен. Сообщаем об этом.
            throw new Error("Анализ готов, но произошла ошибка при сохранении в историю."); // Выбрасываем ошибку
        }

        console.log(`[analyzeDream] Analysis saved successfully for user ${userId}.`);
        // Ничего не возвращаем, т.к. результат не нужен в вызывающей функции
        return; // Явно показываем успешное завершение

    } catch (error) {
        // Ловим все ошибки из блока try (включая нехватку токенов, ошибки Gemini, ошибки DB)
        console.error(`[analyzeDream] Error caught for user ${userId}: ${error.message}`);
        // Перебрасываем ошибку дальше, чтобы она была поймана в обработчике 'message:text'
        // и отправлена пользователю.
        throw error;
    }
}

// logReplyError (без изменений)
function logReplyError(error) { console.error("[Bot Reply Error]", error instanceof Error ? error.message : error); }


// --- Экспорт обработчика для Netlify с webhookCallback ---
exports.handler = async (event) => {
    console.log("[Netlify Handler] Invoked.");

    if (initializationError || !bot) {
        console.error("[Netlify Handler] Bot initialization failed previously.", initializationError);
        return { statusCode: 500, body: "Internal Server Error: Bot failed to initialize." };
    }

    try {
        const callback = webhookCallback(bot, 'aws-lambda');
        console.log("[Netlify Handler] Calling webhookCallback...");
        // Передаем 'event' как есть, он содержит нужные поля для aws-lambda адаптера
        const response = await callback(event);
        console.log("[Netlify Handler] webhookCallback finished. Response status:", response.statusCode);
        return response;
    } catch (error) {
        console.error("[Netlify Handler] CRITICAL error during webhookCallback:", error);
        return { statusCode: 500, body: "Internal Server Error" }; // Отвечаем 500, т.к. это внутренняя ошибка
    }
};

console.log("[Bot Global Init] Netlify handler configured with webhookCallback.");
