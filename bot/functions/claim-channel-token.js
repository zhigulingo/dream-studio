// bot/functions/claim-channel-token.js (Исправлено: добавляем токен, а не устанавливаем)
const { createClient } = require("@supabase/supabase-js");
const { Api, GrammyError } = require('grammy');
const crypto = require('crypto');

// --- Переменные Окружения ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_TMA_ORIGIN = process.env.ALLOWED_TMA_ORIGIN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || '@TheDreamsHub'; // <<<--- ID/юзернейм вашего канала (лучше через ENV)

// --- Ваша Функция валидации InitData ---
function validateTelegramData(initData, botToken) {
    // ... (код функции валидации без изменений) ...
    if (!initData || !botToken) return { valid: false, data: null, error: "Missing initData or botToken" };
    const params = new URLSearchParams(initData); const hash = params.get('hash');
    if (!hash) return { valid: false, data: null, error: "Hash is missing" };
    params.delete('hash'); const dataCheckArr = []; params.sort(); params.forEach((value, key) => dataCheckArr.push(`${key}=${value}`)); const dataCheckString = dataCheckArr.join('\n');
    try {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (checkHash === hash) {
            const userDataString = params.get('user');
            if (!userDataString) { return { valid: true, data: null, error: "User data missing" }; }
            try { const userData = JSON.parse(decodeURIComponent(userDataString)); if (!userData || typeof userData.id === 'undefined') { return { valid: true, data: null, error: "User ID missing" }; } return { valid: true, data: userData, error: null }; }
            catch (parseError) { return { valid: true, data: null, error: "Failed to parse user data" }; }
        } else { return { valid: false, data: null, error: "Hash mismatch" }; }
    } catch (error) { return { valid: false, data: null, error: "Validation crypto error" }; }
}

// --- Генерация Заголовков CORS ---
const generateCorsHeaders = () => {
    const originToAllow = ALLOWED_TMA_ORIGIN || '*';
    console.log(`[claim-channel-token] CORS Headers: Allowing Origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders();

    // --- OPTIONS ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("[claim-channel-token] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }
    // --- POST ---
    if (event.httpMethod !== 'POST') {
        console.log(`[claim-channel-token] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    // --- Config Check ---
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOT_TOKEN || !ALLOWED_TMA_ORIGIN || !TARGET_CHANNEL_ID) {
        console.error("[claim-channel-token] Server configuration missing.");
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing.' }) };
    }

    // --- Validate InitData ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;
    if (!initDataHeader) {
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initDataHeader, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Invalid InitData (${validationResult.error})` }) };
    }
    verifiedUserId = validationResult.data.id;
    console.log(`[claim-channel-token] Access validated for user: ${verifiedUserId}`);

    // --- Основная логика ---
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const api = new Api(BOT_TOKEN);

    try {
        // 1. Проверить, получал ли пользователь награду РАНЕЕ
        console.log(`[claim-channel-token] Checking if reward already claimed for user ${verifiedUserId}...`);
        const { data: userRecord, error: findError } = await supabase
            .from('users')
            .select('id, tokens, channel_reward_claimed') // Выбираем ID, токены и флаг
            .eq('tg_id', verifiedUserId)
            .single();

        if (findError && findError.code !== 'PGRST116') {
            console.error(`[claim-channel-token] Error finding user ${verifiedUserId}:`, findError);
            throw new Error('Database error checking user.');
        }
        if (!userRecord) {
             console.warn(`[claim-channel-token] User ${verifiedUserId} not found in DB.`);
             return { statusCode: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'User profile not found.' }) };
        }
        if (userRecord.channel_reward_claimed) {
            console.log(`[claim-channel-token] Reward already claimed by user ${verifiedUserId}.`);
            return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, alreadyClaimed: true, message: 'Награда уже была получена ранее.' }) };
        }

        // 2. Проверить подписку на канал через Telegram API
        console.log(`[claim-channel-token] Checking channel membership for user ${verifiedUserId} in ${TARGET_CHANNEL_ID}...`);
        let chatMember;
        try {
            // Убедитесь, что бот добавлен в администраторы канала с правом добавления участников (даже если канал публичный)
            chatMember = await api.getChatMember(TARGET_CHANNEL_ID, verifiedUserId);
            console.log(`[claim-channel-token] User ${verifiedUserId} status in ${TARGET_CHANNEL_ID}: ${chatMember.status}`);
        } catch (err) {
             if (err instanceof GrammyError && (err.error_code === 400 || err.error_code === 403)) {
                 console.warn(`[claim-channel-token] Bot API error checking membership for ${verifiedUserId} in ${TARGET_CHANNEL_ID}: ${err.description}. Is bot an admin? Is channel ID correct?`);
                 // Уточняем сообщение для пользователя
                 const checkErrorMsg = err.description.includes('user not found')
                     ? `Подписка не найдена. Вы точно подписаны на ${TARGET_CHANNEL_ID}?`
                     : `Не удалось проверить подписку (${err.description}). Возможно, бот не является администратором канала ${TARGET_CHANNEL_ID}.`;
                 return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: checkErrorMsg }) };
             } else {
                 console.error(`[claim-channel-token] Unexpected Bot API error checking membership:`, err);
                 throw new Error('Telegram API error checking membership.');
             }
        }

        // Проверяем статус подписки
        const subscribedStatuses = ['member', 'administrator', 'creator'];
        if (!subscribedStatuses.includes(chatMember.status)) {
            console.log(`[claim-channel-token] User ${verifiedUserId} is not subscribed (status: ${chatMember.status}).`);
            // Отправляем четкий ответ фронтенду, что подписки нет
            return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, subscribed: false, message: `Ваш статус в канале ${TARGET_CHANNEL_ID}: ${chatMember.status}. Для получения награды нужна активная подписка.` }) };
        }

        // 3. Если подписан и награду не получал - начисляем токен и ставим флаг (ИСПРАВЛЕНО)
        console.log(`[claim-channel-token] User ${verifiedUserId} is subscribed and reward not claimed. Current tokens: ${userRecord.tokens}. Granting token...`);
        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({
                tokens: (userRecord.tokens || 0) + 1, // <<<--- ИСПРАВЛЕНО: Добавляем 1 к текущему значению
                channel_reward_claimed: true          // Ставим флаг
            })
            .eq('id', userRecord.id)                  // Обновляем по внутреннему ID
            .eq('channel_reward_claimed', false)      // Доп. проверка от гонки запросов
            .select('tokens')                         // Возвращаем новое кол-во токенов
            .single();                                // Ожидаем одну обновленную строку

        if (updateError) {
            console.error(`[claim-channel-token] Error updating user ${verifiedUserId} data:`, updateError);
            throw new Error('Database error updating user data.');
        }

        // Проверяем, что обновление реально произошло
        if (!updatedUser) {
             console.warn(`[claim-channel-token] Failed to update user ${verifiedUserId} (maybe race condition or already claimed?).`);
              return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, alreadyClaimed: true, message: 'Награда уже была получена (возможно, другим запросом).' }) };
        }

        const newTotalTokens = updatedUser.tokens;
        console.log(`[claim-channel-token] Token granted successfully for user ${verifiedUserId}. New token balance: ${newTotalTokens}`);
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            // Отправляем новое общее количество токенов
            body: JSON.stringify({ success: true, message: 'Поздравляем! 1 токен начислен за подписку.', newTokens: newTotalTokens })
        };

    } catch (error) {
        console.error(`[claim-channel-token] Catch block error for user ${verifiedUserId}:`, error.message);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Внутренняя ошибка сервера при проверке награды.' })
        };
    }
};
// --- КОНЕЦ ФАЙЛА claim-channel-token.js ---
