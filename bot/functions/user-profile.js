// bot/functions/user-profile.js (Упрощенный)
const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Функция валидации Telegram InitData ---
function validateTelegramData(initData, botToken) {
    if (!initData || !botToken) return { valid: false, data: null };
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, data: null };
    params.delete('hash');
    const dataCheckArr = [];
    params.sort();
    params.forEach((value, key) => dataCheckArr.push(`${key}=${value}`));
    const dataCheckString = dataCheckArr.join('\n');
    try {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (checkHash === hash) {
            const userData = params.get('user');
            if (!userData) return { valid: false, data: null };
            return { valid: true, data: JSON.parse(decodeURIComponent(userData)) };
        } else { console.warn("[user-profile] InitData validation failed: hash mismatch."); return { valid: false, data: null }; }
    } catch (error) { console.error("[user-profile] Error during InitData validation:", error); return { valid: false, data: null }; }
}

exports.handler = async (event) => {
    // --- Убрана обработка OPTIONS и генерация CORS ---

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Content-Type': 'application/json' } };
    }

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }), headers: { 'Content-Type': 'application/json' } };
    }

    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("[user-profile] Invalid or missing Telegram User Data after validation");
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }), headers: { 'Content-Type': 'application/json' } };
    }

    const tgUserId = validationResult.data.id;
    console.log(`[user-profile] Fetching profile for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("[user-profile] Missing Supabase credentials");
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing' }), headers: { 'Content-Type': 'application/json' } };
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end')
            .eq('tg_id', tgUserId)
            .maybeSingle();

        if (userError) throw userError;

        let responseBody;
        if (!userData) {
            console.log(`[user-profile] User profile not found for tg_id: ${tgUserId}. Returning default.`);
            responseBody = { tokens: 0, subscription_type: 'free', subscription_end: null };
        } else {
            console.log(`[user-profile] Profile found for tg_id ${tgUserId}.`);
            responseBody = userData;
        }

        return {
            statusCode: 200,
            // Заголовки Content-Type и CORS добавит Netlify
            body: JSON.stringify(responseBody)
        };

    } catch (error) {
        console.error(`[user-profile] Error for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500,
            // Заголовки Content-Type и CORS добавит Netlify
            body: JSON.stringify({ error: 'Internal Server Error' })
         };
    }
};
