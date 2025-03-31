// bot/functions/create-invoice.js (С ручным CORS и * для отладки)
const { Api, GrammyError } = require('grammy');
const crypto = require('crypto');

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
        } else { console.warn("[create-invoice] InitData validation failed: hash mismatch."); return { valid: false, data: null }; }
    } catch (error) { console.error("[create-invoice] Error during InitData validation:", error); return { valid: false, data: null }; }
}

// --- ВЕРНУЛИ Заголовки CORS (с * для отладки) ---
const generateCorsHeaders = () => {
    const originToAllow = '*'; // ВРЕМЕННО РАЗРЕШАЕМ ВСЕ
    console.log(`[create-invoice] CORS Headers: Allowing Origin: ${originToAllow}`);
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
        console.log("[create-invoice] Responding to OPTIONS request");
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Обработка POST запроса ---
    if (event.httpMethod !== 'POST') {
        console.log(`[create-invoice] Method Not Allowed: ${event.httpMethod}`);
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Валидация InitData ---
    console.log("[create-invoice] Received request body (raw):", event.body); // Лог для отладки
    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
         console.warn("[create-invoice] Unauthorized: Missing Telegram InitData header");
         return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("[create-invoice] Unauthorized: Invalid Telegram Data after validation");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }) };
    }
    const tgUserId = validationResult.data.id;
    console.log(`[create-invoice] Request validated for user: ${tgUserId}`);

    // --- Получение данных из тела запроса ---
    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
        console.log("[create-invoice] Parsed request body:", requestBody);
    } catch (e) {
         console.error("[create-invoice] Failed to parse JSON body:", e);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Invalid JSON body' }) };
    }

    const { plan, duration, amount, payload } = requestBody;
    if (!plan || !duration || !amount || !payload || typeof amount !== 'number' || amount <= 0) {
         console.error(`[create-invoice] Invalid request parameters for user ${tgUserId}:`, requestBody);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters' }) };
    }

    // --- Проверка конфигурации ---
    if (!BOT_TOKEN) {
         console.error("[create-invoice] FATAL: BOT_TOKEN is missing!");
        return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
     }

    // --- Создание ссылки на инвойс ---
    let api;
    try {
        api = new Api(BOT_TOKEN);
        const title = `Подписка ${plan} (${duration} мес.)`;
        const description = `Оплата подписки ${plan} на ${duration} месяца в Dream Analyzer`;
        const currency = 'XTR';
        const prices = [{ label: `Подписка ${plan} ${duration} мес.`, amount: amount }];

        console.log(`[create-invoice] Attempting to call api.raw.createInvoiceLink for user ${tgUserId}...`);
        const invoiceLink = await api.raw.createInvoiceLink({ title, description, payload, currency, prices });
        console.log(`[create-invoice] Successfully created invoice link for user ${tgUserId}:`, invoiceLink);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ invoiceUrl: invoiceLink })
        };

    } catch (error) {
        console.error(`[create-invoice] Error during createInvoiceLink call for user ${tgUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        let statusCode = 500;
        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
            if (error.error_code >= 400 && error.error_code < 500) { statusCode = 400; errorMessage = `Bad Request: ${error.description}`; }
        } else if (error.message) { errorMessage = error.message; }

        return {
            statusCode: statusCode,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, // Добавляем CORS
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
