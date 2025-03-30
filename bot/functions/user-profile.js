// bot/functions/user-profile.js

console.log('--- Triggering rebuild for user-profile function v2 ---'); // <<<--- ДОБАВЬТЕ ЭТУ СТРОКУ

const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');
// ... остальной код файла ...

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TMA_ORIGIN = process.env.TMA_URL; // Ожидаем URL ТМА из переменных окружения


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

// --- Заголовки CORS ---
const generateCorsHeaders = () => {
    // Если TMA_ORIGIN не задан, разрешаем все (менее безопасно, для отладки)
    const originToAllow = allowedOrigin || '*';
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data', // Разрешаем нужные заголовки
        'Access-Control-Allow-Methods': 'GET, OPTIONS', // Разрешаем методы
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders();

    // --- Обработка Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: corsHeaders,
            body: '',
        };
    }

    // --- Основная логика для GET запроса ---
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405, // Method Not Allowed
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
        return {
            statusCode: 401, // Unauthorized
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' })
        };
    }

    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("Invalid or missing Telegram User Data after validation");
        return {
            statusCode: 401, // Unauthorized
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' })
        };
    }

    const tgUserId = validationResult.data.id;
    console.log(`Fetching profile for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { /* ... */ } // Проверка Supabase

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end')
            .eq('tg_id', tgUserId)
            .maybeSingle();

        if (userError) throw userError; // Выбросить ошибку, чтобы поймать ниже

        let responseBody;
        if (!userData) {
            console.log(`User profile not found for tg_id: ${tgUserId}. Returning default.`);
            responseBody = { tokens: 0, subscription_type: 'free', subscription_end: null };
        } else {
            console.log(`Profile found for tg_id ${tgUserId}:`, userData);
            responseBody = userData;
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify(responseBody)
        };

    } catch (error) {
        console.error(`Error in user-profile function for tg_id ${tgUserId}:`, error);
        return {
            statusCode: 500, // Internal Server Error
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ error: 'Internal Server Error' })
         };
    }
};
