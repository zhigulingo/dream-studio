// bot/functions/analyses-history.js (Исправлено: без внешних библиотек)
const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto'); // Используем встроенный crypto

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
// Убедитесь, что эта переменная установлена в Netlify UI для сайта бэкенда!
const ALLOWED_TMA_ORIGIN = process.env.ALLOWED_TMA_ORIGIN;

// --- ВАША Функция валидации Telegram InitData (без внешних библиотек) ---
function validateTelegramData(initData, botToken) {
    // ... (ТОЧНО ТАКАЯ ЖЕ ФУНКЦИЯ, КАК В user-profile.js) ...
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
    params.delete('hash');
    const dataCheckArr = [];
    params.sort();
    params.forEach((value, key) => dataCheckArr.push(`${key}=${value}`));
    const dataCheckString = dataCheckArr.join('\n');
    try {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (checkHash === hash) {
            const userDataString = params.get('user');
            if (!userDataString) { return { valid: true, data: null, error: "User data missing" }; }
            try {
                const userData = JSON.parse(decodeURIComponent(userDataString));
                if (!userData || typeof userData.id === 'undefined') { return { valid: true, data: null, error: "User ID missing in parsed data" }; }
                return { valid: true, data: userData, error: null };
            } catch (parseError) { return { valid: true, data: null, error: "Failed to parse user data" }; }
        } else { return { valid: false, data: null, error: "Hash mismatch" }; }
    } catch (error) { return { valid: false, data: null, error: "Validation crypto error" }; }
}

// --- Генерация Заголовков CORS ---
const generateCorsHeaders = () => {
    const originToAllow = ALLOWED_TMA_ORIGIN || '*'; // Используем переменную или '*' если она не задана
    console.log(`[analyses-history] CORS Headers: Allowing Origin: ${originToAllow}`);
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
        console.log("[analyses-history] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Проверка метода ---
    if (event.httpMethod !== 'GET') {
         console.log(`[analyses-history] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

   // --- Проверка конфигурации сервера ---
     if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN || !ALLOWED_TMA_ORIGIN) { // Добавили проверку ALLOWED_TMA_ORIGIN
        console.error("[analyses-history] Server configuration missing (Supabase URL/Key, Bot Token, or Allowed Origin)");
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing.' }) };
     }

    // --- Валидация InitData с использованием ВАШЕЙ функции ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[analyses-history] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    const validationResult = validateTelegramData(initDataHeader, BOT_TOKEN);

    if (!validationResult.valid) {
         console.error(`[analyses-history] InitData validation failed: ${validationResult.error}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Invalid Telegram InitData (${validationResult.error})` }) };
    }
    if (!validationResult.data || typeof validationResult.data.id === 'undefined') {
         console.error(`[analyses-history] InitData is valid, but user data/ID is missing or failed to parse: ${validationResult.error}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Could not extract user data from InitData (${validationResult.error})` }) };
    }

    verifiedUserId = validationResult.data.id;
    console.log(`[analyses-history] Access validated for user: ${verifiedUserId}`);

    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
             auth: { autoRefreshToken: false, persistSession: false }
        });

        // 1. Найти ID пользователя в нашей БД по проверенному tg_id
        const { data: user, error: userFindError } = await supabase
            .from('users')
            .select('id')
            .eq('tg_id', verifiedUserId)
            .single();

        if (userFindError) {
            if (userFindError.code === 'PGRST116') {
                 console.log(`[analyses-history] User ${verifiedUserId} not found in DB. Returning empty history.`);
                 return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
            } else {
                 console.error(`[analyses-history] Error finding user ${verifiedUserId}:`, userFindError);
                 throw new Error("Database query failed while finding user");
            }
        }

        const userDbId = user.id;
        console.log(`[analyses-history] Found internal user ID: ${userDbId} for tg_id: ${verifiedUserId}`);

        // 2. Получить историю анализов по внутреннему user_id
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at')
            .eq('user_id', userDbId)
            .order('created_at', { ascending: false })
            .limit(50);

        if (historyError) {
            console.error(`[analyses-history] Supabase error fetching history for user_id ${userDbId}:`, historyError);
            throw new Error("Database query failed while fetching history");
        }

        console.log(`[analyses-history] History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(history || [])
        };

    } catch (error) {
        console.error(`[analyses-history] Catch block error for tg_id ${verifiedUserId}:`, error.message);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal Server Error while fetching history.' })
        };
    }
};
