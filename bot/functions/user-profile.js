// bot/functions/user-profile.js (Исправлено: без внешних библиотек)
const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto'); // Используем встроенный crypto

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
// Убедитесь, что эта переменная установлена в Netlify UI для сайта бэкенда!
const ALLOWED_TMA_ORIGIN = process.env.ALLOWED_TMA_ORIGIN;

// --- ВАША Функция валидации Telegram InitData (без внешних библиотек) ---
function validateTelegramData(initData, botToken) {
    if (!initData || !botToken) {
        console.warn("[validateTelegramData] Missing initData or botToken");
        return { valid: false, data: null, error: "Missing initData or botToken" };
    }
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
        console.warn("[validateTelegramData] Hash is missing in initData");
        return { valid: false, data: null, error: "Hash is missing" };
    }
    params.delete('hash'); // Удаляем hash для проверки
    const dataCheckArr = [];
    params.sort(); // Важно сортировать параметры
    params.forEach((value, key) => dataCheckArr.push(`${key}=${value}`));
    const dataCheckString = dataCheckArr.join('\n');

    try {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (checkHash === hash) {
            // Валидация успешна, пытаемся извлечь данные пользователя
            const userDataString = params.get('user');
            if (!userDataString) {
                console.warn("[validateTelegramData] User data is missing in initData");
                return { valid: true, data: null, error: "User data missing" }; // Валидно, но данных нет
            }
            try {
                const userData = JSON.parse(decodeURIComponent(userDataString));
                 // Проверяем наличие ID пользователя
                 if (!userData || typeof userData.id === 'undefined') {
                    console.warn("[validateTelegramData] Parsed user data is missing ID");
                    return { valid: true, data: null, error: "User ID missing in parsed data" };
                 }
                return { valid: true, data: userData, error: null };
            } catch (parseError) {
                console.error("[validateTelegramData] Error parsing user data JSON:", parseError);
                return { valid: true, data: null, error: "Failed to parse user data" }; // Валидно, но данные пользователя не распарсились
            }
        } else {
            console.warn("[validateTelegramData] Hash mismatch during validation.");
            return { valid: false, data: null, error: "Hash mismatch" };
        }
    } catch (error) {
        console.error("[validateTelegramData] Crypto error during validation:", error);
        return { valid: false, data: null, error: "Validation crypto error" };
    }
}


// --- Генерация Заголовков CORS ---
const generateCorsHeaders = () => {
    const originToAllow = ALLOWED_TMA_ORIGIN || '*'; // Используем переменную или '*' если она не задана
    console.log(`[user-profile] CORS Headers: Allowing Origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders();

    // --- Обработка Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("[user-profile] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Проверка метода ---
    if (event.httpMethod !== 'GET') {
        console.log(`[user-profile] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Проверка конфигурации сервера ---
     if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOT_TOKEN || !ALLOWED_TMA_ORIGIN) { // Добавили проверку ALLOWED_TMA_ORIGIN
        console.error("[user-profile] Server configuration missing (Supabase URL/Key, Bot Token, or Allowed Origin)");
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing.' }) };
     }

    // --- Валидация InitData с использованием ВАШЕЙ функции ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[user-profile] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    const validationResult = validateTelegramData(initDataHeader, BOT_TOKEN);

    if (!validationResult.valid) {
        console.error(`[user-profile] InitData validation failed: ${validationResult.error}`);
        return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Invalid Telegram InitData (${validationResult.error})` }) };
    }

    // Проверяем, что ID пользователя был успешно извлечен
    if (!validationResult.data || typeof validationResult.data.id === 'undefined') {
         console.error(`[user-profile] InitData is valid, but user data/ID is missing or failed to parse: ${validationResult.error}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Could not extract user data from InitData (${validationResult.error})` }) };
    }

    verifiedUserId = validationResult.data.id;
    console.log(`[user-profile] Access validated for user: ${verifiedUserId}`);

    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
           auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end')
            .eq('tg_id', verifiedUserId)
            .maybeSingle();

        if (userError) {
             console.error(`[user-profile] Supabase error for tg_id ${verifiedUserId}:`, userError);
             throw new Error("Database query failed");
        }

        let responseBody;
        if (!userData) {
            console.log(`[user-profile] User profile not found for tg_id: ${verifiedUserId}. Returning default free user state.`);
            responseBody = { tokens: 0, subscription_type: 'free', subscription_end: null };
        } else {
            console.log(`[user-profile] Profile data found for tg_id ${verifiedUserId}.`);
            responseBody = userData;
        }

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(responseBody)
        };

    } catch (error) {
        console.error(`[user-profile] Catch block error for tg_id ${verifiedUserId}:`, error.message);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal Server Error while fetching profile.' })
         };
    }
};
