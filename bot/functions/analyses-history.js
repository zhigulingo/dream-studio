// bot/functions/analyses-history.js (Обновлено с @tma.js/init-data-node)
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
     if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOT_TOKEN) {
        console.error("[analyses-history] Server configuration missing (Supabase URL/Key or Bot Token)");
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Configuration missing.' }) };
     }

    // --- Валидация InitData с использованием библиотеки ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[analyses-history] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    try {
        validate(initDataHeader, BOT_TOKEN, { expiresIn: 3600 });
        const parsedData = parse(initDataHeader);
        verifiedUserId = parsedData.user?.id;
        if (!verifiedUserId) {
            console.error("[analyses-history] InitData is valid, but user ID is missing.");
            throw new Error("User ID missing in InitData");
        }
        console.log(`[analyses-history] Access validated for user: ${verifiedUserId}`);
    } catch (error) {
        console.error("[analyses-history] InitData validation failed:", error.message);
        return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden: Invalid or expired Telegram InitData" }) };
    }

    // --- Основная логика ---
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
             auth: { autoRefreshToken: false, persistSession: false }
        });

        // 1. Найти ID пользователя в нашей БД по проверенному tg_id
        const { data: user, error: userFindError } = await supabase
            .from('users')
            .select('id') // Выбираем только внутренний ID
            .eq('tg_id', verifiedUserId) // <<<--- ИСПОЛЬЗУЕМ ПРОВЕРЕННЫЙ ID
            .single(); // Ожидаем одного пользователя или ошибку

        // Обработка ошибки поиска пользователя (включая случай, когда пользователь не найден)
        if (userFindError) {
             // Код 'PGRST116' означает "не найдено ни одной строки" при использовании .single()
            if (userFindError.code === 'PGRST116') {
                 console.log(`[analyses-history] User ${verifiedUserId} not found in DB. Returning empty history.`);
                 // Возвращаем пустой массив, т.к. пользователь не найден
                 return { statusCode: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
            } else {
                // Другая ошибка Supabase при поиске пользователя
                 console.error(`[analyses-history] Error finding user ${verifiedUserId}:`, userFindError);
                 throw new Error("Database query failed while finding user"); // Переходим в блок catch
            }
        }

        // Если пользователь найден, у нас есть его внутренний userDbId
        const userDbId = user.id;
        console.log(`[analyses-history] Found internal user ID: ${userDbId} for tg_id: ${verifiedUserId}`);

        // 2. Получить историю анализов по внутреннему user_id
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at')
            .eq('user_id', userDbId) // <<<--- ИСПОЛЬЗУЕМ ВНУТРЕННИЙ ID ПОЛЬЗОВАТЕЛЯ
            .order('created_at', { ascending: false })
            .limit(50); // Ограничиваем выборку для производительности

        if (historyError) {
            console.error(`[analyses-history] Supabase error fetching history for user_id ${userDbId}:`, historyError);
            throw new Error("Database query failed while fetching history"); // Переходим в блок catch
        }

        console.log(`[analyses-history] History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(history || []) // Возвращаем пустой массив, если история пуста
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
