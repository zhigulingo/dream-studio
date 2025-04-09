// bot/functions/create-invoice.js (Обновлено с @tma.js/init-data-node)
const { Api, GrammyError } = require('grammy');
const { validate, parse } = require('@tma.js/init-data-node'); // <<<--- ИСПОЛЬЗУЕМ БИБЛИОТЕКУ

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_TMA_ORIGIN = process.env.ALLOWED_TMA_ORIGIN || 'https://tourmaline-eclair-9d40ea.netlify.app'; // <<<--- ЗАМЕНИТЕ '*' НА ВАШ URL ИЛИ ИСПОЛЬЗУЙТЕ ENV

// --- Генерация Заголовков CORS ---
const generateCorsHeaders = () => {
    // ВАЖНО: В продакшене используйте конкретный Origin вашего TMA вместо '*'
    // const originToAllow = '*'; // Для локальной отладки
    const originToAllow = ALLOWED_TMA_ORIGIN; // Для продакшена
    console.log(`[create-invoice] CORS Headers: Allowing Origin: ${originToAllow}`);
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
        console.log("[create-invoice] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Проверка метода ---
    if (event.httpMethod !== 'POST') {
        console.log(`[create-invoice] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Проверка конфигурации сервера ---
    if (!BOT_TOKEN) {
         console.error("[create-invoice] Server configuration missing (Bot Token)");
         return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
     }

    // --- Валидация InitData с использованием библиотеки ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[create-invoice] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    try {
        validate(initDataHeader, BOT_TOKEN, { expiresIn: 3600 });
        const parsedData = parse(initDataHeader);
        verifiedUserId = parsedData.user?.id;
        if (!verifiedUserId) {
             console.error("[create-invoice] InitData is valid, but user ID is missing.");
             throw new Error("User ID missing in InitData");
        }
        console.log(`[create-invoice] Access validated for user: ${verifiedUserId}`);
    } catch (error) {
        console.error("[create-invoice] InitData validation failed:", error.message);
        return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden: Invalid or expired Telegram InitData" }) };
    }

    // --- Получение и валидация данных из тела запроса ---
    let requestBody;
    try {
        // Проверяем наличие тела перед парсингом
        if (!event.body) {
             console.error("[create-invoice] Bad Request: Missing request body.");
             throw new Error('Missing request body');
        }
        requestBody = JSON.parse(event.body);
        console.log(`[create-invoice] Parsed request body for user ${verifiedUserId}:`, requestBody);
    } catch (e) {
        console.error(`[create-invoice] Failed to parse JSON body for user ${verifiedUserId}:`, e.message);
        // Ошибка парсинга или отсутствия тела - это 400 Bad Request
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Bad Request: ${e.message}` }) };
    }

    const { plan, duration, amount, payload } = requestBody;

    // Более строгая валидация входных данных
    if (!plan || typeof plan !== 'string' || !duration || typeof duration !== 'number' || duration <= 0 || !amount || typeof amount !== 'number' || amount <= 0 || !payload || typeof payload !== 'string') {
        console.error(`[create-invoice] Invalid request parameters for user ${verifiedUserId}:`, requestBody);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters (plan, duration, amount, payload)' }) };
    }

    // Дополнительная проверка: ID пользователя в payload должен совпадать с проверенным ID
    const payloadParts = payload.split('_'); // Ожидаемый формат: sub_plan_duration_tgUserId
    const payloadUserId = payloadParts.length > 3 ? parseInt(payloadParts[3], 10) : null;
    if (payloadUserId !== verifiedUserId) {
         console.error(`[create-invoice] Security Alert: Payload user ID (${payloadUserId}) does not match validated InitData user ID (${verifiedUserId}). Payload: ${payload}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden: User ID mismatch' }) };
    }
    console.log(`[create-invoice] Payload user ID matches validated user ID for ${verifiedUserId}.`);


    // --- Создание ссылки на инвойс ---
    let api;
    try {
        api = new Api(BOT_TOKEN);

        // Формируем данные для инвойса
        const title = `Подписка ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${duration} мес.)`;
        const description = `Оплата подписки "${plan}" на ${duration} месяца в Dream Analyzer`;
        const currency = 'XTR'; // Используйте вашу валюту провайдера
        // Сумма должна быть в минимальных единицах валюты (копейки, центы и т.д.)
        // Убедитесь, что `amount` передается из фронтенда уже в этих единицах!
        const prices = [{ label: `Подписка ${plan} ${duration} мес.`, amount: amount }];

        console.log(`[create-invoice] Attempting to call api.raw.createInvoiceLink for user ${verifiedUserId} with payload ${payload}...`);
        const invoiceLink = await api.raw.createInvoiceLink({
            title,
            description,
            payload, // Используем payload, пришедший от клиента (уже проверенный)
            provider_token: process.env.PAYMENT_PROVIDER_TOKEN, // <<<--- Убедитесь, что эта переменная установлена в Netlify!
            currency,
            prices
            // Можете добавить другие параметры, например: photo_url, need_name, etc.
        });
        console.log(`[create-invoice] Successfully created invoice link for user ${verifiedUserId}.`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceUrl: invoiceLink }) // Возвращаем только URL
        };

    } catch (error) {
        console.error(`[create-invoice] Error during createInvoiceLink call for user ${verifiedUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        let statusCode = 500;

        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
             // Ошибки 4xx от Telegram обычно означают неверные параметры запроса
            if (error.error_code >= 400 && error.error_code < 500) {
                 statusCode = 400; // Возвращаем Bad Request клиенту
                 errorMessage = `Bad Request to Telegram API: ${error.description}`;
            }
        } else if (error.message) {
            // Другие типы ошибок
            errorMessage = error.message;
        }

        return {
            statusCode: statusCode,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
