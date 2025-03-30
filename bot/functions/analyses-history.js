const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TMA_ORIGIN = process.env.TMA_URL;

// --- Функция валидации Telegram InitData (остается без изменений) ---
function validateTelegramData(initData, botToken) { /* ... (код функции) ... */
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
        } else {
            console.warn("Telegram InitData validation failed: hash mismatch.");
            return { valid: false, data: null };
        }
    } catch (error) {
        console.error("Error during Telegram InitData validation:", error);
        return { valid: false, data: null };
    }
}

// --- Заголовки CORS (ВРЕМЕННАЯ ОТЛАДОЧНАЯ ВЕРСИЯ) ---
const generateCorsHeaders = () => {
    // !!! ВРЕМЕННО РАЗРЕШАЕМ ВСЕ ИСТОЧНИКИ ДЛЯ ОТЛАДКИ !!!
    const originToAllow = '*';
    console.log(`[DEBUG] Using CORS Allow-Origin: ${originToAllow}`); // Добавим лог
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
};


exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders();

    // --- Обработка Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Основная логика для GET запроса ---
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
        return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' })
        };
    }

    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("Invalid or missing Telegram User Data after validation");
        return {
            statusCode: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' })
        };
    }

    const tgUserId = validationResult.data.id;
    console.log(`Fetching history for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { /* ... */ } // Проверка Supabase

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: user, error: userFindError } = await supabase
            .from('users').select('id').eq('tg_id', tgUserId).single();

        if (userFindError || !user) {
            console.error(`User not found in 'users' table for tg_id ${tgUserId}:`, userFindError);
            return {
                statusCode: 200, // Все равно OK, просто история пустая
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify([])
            };
        }

        const userDbId = user.id;
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at')
            .eq('user_id', userDbId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (historyError) throw historyError;

        console.log(`History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify(history || [])
        };

    } catch (error) {
        console.error(`Error in analyses-history function for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
