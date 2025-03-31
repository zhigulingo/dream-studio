// bot/functions/analyses-history.js (Упрощенный)
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
        } else { console.warn("[analyses-history] InitData validation failed: hash mismatch."); return { valid: false, data: null }; }
    } catch (error) { console.error("[analyses-history] Error during InitData validation:", error); return { valid: false, data: null }; }
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
        console.error("[analyses-history] Invalid or missing Telegram User Data after validation");
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }), headers: { 'Content-Type': 'application/json' } };
    }

    const tgUserId = validationResult.data.id;
    console.log(`[analyses-history] Fetching history for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("[analyses-history] Missing Supabase credentials");
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing' }), headers: { 'Content-Type': 'application/json' } };
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: user, error: userFindError } = await supabase
            .from('users').select('id').eq('tg_id', tgUserId).single();

        if (userFindError || !user) {
            console.log(`[analyses-history] User not found in 'users' table for tg_id ${tgUserId}. Returning empty history.`);
            return { statusCode: 200, body: JSON.stringify([]), /* Headers добавит Netlify */ };
        }

        const userDbId = user.id;
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at')
            .eq('user_id', userDbId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (historyError) throw historyError;

        console.log(`[analyses-history] History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            // Заголовки Content-Type и CORS добавит Netlify
            body: JSON.stringify(history || [])
        };

    } catch (error) {
        console.error(`[analyses-history] Error for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500,
             // Заголовки Content-Type и CORS добавит Netlify
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
