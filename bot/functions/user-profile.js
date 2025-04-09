// bot/functions/user-profile.js (Обновлено с @tma.js/init-data-node)
const { createClient } = require("@supabase/supabase-js");
const { validate, parse } = require('@tma.js/init-data-node'); // <<<--- ИСПОЛЬЗУЕМ БИБЛИОТЕКУ

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_TMA_ORIGIN = process.env.ALLOWED_TMA_ORIGIN || 'https://tourmaline-eclair-9d40ea.netlify.app'; // <<<--- ЗАМЕНИТЕ '*' НА ВАШ URL ИЛИ ИСПОЛЬЗУЙТЕ ENV

// --- Генерация Заголовков CORS ---
const generateCorsHeaders = () => {
    // ВАЖНО: В продакшене используйте конкретный Origin вашего TMA вместо '*'
    // const originToAllow = '*'; // Для локальной отладки
    const originToAllow = ALLOWED_TMA_ORIGIN; // Для продакшена
    console.log(`[user-profile] CORS Headers: Allowing Origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data', // Добавляем X-Telegram-Init-Data
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // Разрешаем нужные методы
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders();

    // --- Обработка Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("[user-profile] Responding to OPTIONS request");
        return {
            statusCode: 204, // No Content
            headers: corsHeaders,
            body: '',
        };
    }

    // --- Проверка метода ---
    if (event.httpMethod !== 'GET') {
        console.log(`[user-profile] Method Not Allowed: ${event.httpMethod}`);
        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // --- Проверка конфигурации сервера ---
     if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOT_TOKEN) {
        console.error("[user-profile] Server configuration missing (Supabase URL/Key or Bot Token)");
        // Не отправляем CORS для 500 ошибки, т.к. это проблема сервера
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing.' }) };
     }

    // --- Валидация InitData с использованием библиотеки ---
    const initDataHeader = event.headers['x-telegram-init-data']; // Заголовки в Netlify в нижнем регистре
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[user-profile] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    try {
        // Верификация initData (выбрасывает ошибку, если невалидна)
        validate(initDataHeader, BOT_TOKEN, { expiresIn: 3600 }); // expiresIn: 1 час

        // Парсинг данных ПОСЛЕ успешной верификации
        const parsedData = parse(initDataHeader);
        verifiedUserId = parsedData.user?.id;

        if (!verifiedUserId) {
           console.error("[user-profile] InitData is valid, but user ID is missing.");
           throw new Error("User ID missing in InitData"); // Переходим в блок catch
        }

        console.log(`[user-profile] Access validated for user: ${verifiedUserId}`);

    } catch (error) {
        console.error("[user-profile] InitData validation failed:", error.message);
        return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden: Invalid or expired Telegram InitData" }) };
    }

    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
           auth: { autoRefreshToken: false, persistSession: false } // Рекомендуется для serverless
        });

        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end')
            .eq('tg_id', verifiedUserId) // <<<--- ИСПОЛЬЗУЕМ ПРОВЕРЕННЫЙ ID
            .maybeSingle(); // Используем maybeSingle, чтобы не было ошибки, если юзера нет

        if (userError) {
             console.error(`[user-profile] Supabase error for tg_id ${verifiedUserId}:`, userError);
             // Не показываем детали ошибки Supabase пользователю
             throw new Error("Database query failed"); // Переходим в блок catch
        }

        let responseBody;
        if (!userData) {
            // Важно: Не создаем пользователя здесь. Пользователя создает бот при /start или первом анализе.
            // Если профиля нет, это значит, пользователь еще не взаимодействовал с ботом.
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
        // Логируем исходную ошибку (может быть из Supabase или наша "Database query failed")
        console.error(`[user-profile] Catch block error for tg_id ${verifiedUserId}:`, error.message);
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal Server Error while fetching profile.' })
         };
    }
};
