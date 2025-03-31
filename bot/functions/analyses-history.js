// bot/functions/analyses-history.js (С ручным CORS и * для отладки)
const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
// TMA_ORIGIN не используем, пока стоит '*'

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

// --- ВЕРНУЛИ Заголовки CORS (с * для отладки) ---
const generateCorsHeaders = () => {
    const originToAllow = '*'; // ВРЕМЕННО РАЗРЕШАЕМ ВСЕ
    console.log(`[analyses-history] CORS Headers: Allowing Origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders(); // <<<--- ВЕРНУЛИ вызов

    // --- ВЕРНУЛИ Обработку Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("[analyses-history] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Обработка GET запроса ---
    if (event.httpMethod !== 'GET') {
         console.log(`[analyses-history] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Валидация InitData ---
    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
         console.warn("[analyses-history] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
         console.error("[analyses-history] Unauthorized: Invalid Telegram Data after validation");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }) };
    }
    const tgUserId = validationResult.data.id;
    console.log(`[analyses-history] Fetching history for validated tg_id: ${tgUserId}`);

    // --- Проверка конфигурации ---
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
         console.error("[analyses-history] Missing Supabase credentials");
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing' }) };
    }
     if (!BOT_TOKEN) {
         console.error("[analyses-history] Missing BOT_TOKEN for validation");
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
     }

    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        // 1. Найти ID пользователя
        const { data: user, error: userFindError } = await supabase
            .from('users').select('id').eq('tg_id', tgUserId).single();

        if (userFindError || !user) {
            // Если ошибка НЕ "не найдено", то логируем ее
            if (userFindError && userFindError.code !== 'PGRST116') {
                 console.error(`[analyses-history] Error finding user ${tgUserId}:`, userFindError);
            } else {
                 console.log(`[analyses-history] User ${tgUserId} not found in DB. Returning empty history.`);
            }
            // Возвращаем пустой массив в любом случае, если пользователя нет
            return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
        }

        const userDbId = user.id;
        // 2. Получить историю
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at')
            .eq('user_id', userDbId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (historyError) {
            console.error(`[analyses-history] Supabase error fetching history for user_id ${userDbId}:`, historyError);
            throw historyError;
        }

        console.log(`[analyses-history] History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify(history || [])
        };

    } catch (error) {
        console.error(`[analyses-history] Catch block error for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ error: 'Internal Server Error while fetching history.' })
        };
    }
};
