// bot/functions/user-profile.js (С ручным CORS и * для отладки)
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
        } else { console.warn("[user-profile] InitData validation failed: hash mismatch."); return { valid: false, data: null }; }
    } catch (error) { console.error("[user-profile] Error during InitData validation:", error); return { valid: false, data: null }; }
}

// --- ВЕРНУЛИ Заголовки CORS (с * для отладки) ---
const generateCorsHeaders = () => {
    const originToAllow = '*'; // ВРЕМЕННО РАЗРЕШАЕМ ВСЕ
    console.log(`[user-profile] CORS Headers: Allowing Origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // Разрешаем все нужные методы
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders(); // <<<--- ВЕРНУЛИ вызов

    // --- ВЕРНУЛИ Обработку Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("[user-profile] Responding to OPTIONS request");
        return {
            statusCode: 204, // No Content - правильный ответ для preflight
            headers: corsHeaders,
            body: '',
        };
    }

    // --- Обработка GET запроса ---
    if (event.httpMethod !== 'GET') {
        console.log(`[user-profile] Method Not Allowed: ${event.httpMethod}`);
        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // --- Валидация InitData (добавляем CORS в ответы об ошибках) ---
    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
         console.warn("[user-profile] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
         console.error("[user-profile] Unauthorized: Invalid Telegram Data after validation");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }) };
    }
    const tgUserId = validationResult.data.id;
    console.log(`[user-profile] Fetching profile for validated tg_id: ${tgUserId}`);

    // --- Проверка конфигурации (добавляем CORS в ответ об ошибке) ---
     if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("[user-profile] Missing Supabase credentials");
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing' }) };
     }
     if (!BOT_TOKEN) { // Добавим проверку токена бота, раз он нужен для валидации
         console.error("[user-profile] Missing BOT_TOKEN for validation");
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
     }


    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end')
            .eq('tg_id', tgUserId)
            .maybeSingle();

        if (userError) {
             console.error(`[user-profile] Supabase error for tg_id ${tgUserId}:`, userError);
             throw userError; // Выбросить ошибку, чтобы поймать ниже
        }

        let responseBody;
        if (!userData) {
            console.log(`[user-profile] User profile not found for tg_id: ${tgUserId}. Returning default.`);
            // Создадим пользователя сразу при первом запросе профиля? Или пусть бот создает?
            // Пока возвращаем дефолт
            responseBody = { tokens: 0, subscription_type: 'free', subscription_end: null };
        } else {
            console.log(`[user-profile] Profile data found for tg_id ${tgUserId}.`);
            responseBody = userData;
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS к успешному ответу
            body: JSON.stringify(responseBody)
        };

    } catch (error) {
        console.error(`[user-profile] Catch block error for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS к ответу об ошибке
            body: JSON.stringify({ error: 'Internal Server Error while fetching profile.' })
         };
    }
};
