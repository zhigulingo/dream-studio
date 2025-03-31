// bot/functions/create-invoice.js
const { Api, GrammyError } = require('grammy');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const TMA_ORIGIN = process.env.TMA_URL;

function validateTelegramData(initData, botToken) { /* ... код ... */ } // Код валидации без изменений

const generateCorsHeaders = (allowedOrigin) => { // Код CORS без изменений
    const originToAllow = allowedOrigin || '*';
    console.log(`[create-invoice] CORS: Checking origin. Allowed: ${originToAllow}`);
    if (!allowedOrigin && originToAllow === '*') { console.warn("[create-invoice] CORS: Allowing any origin because TMA_URL is not set!"); }
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders(TMA_ORIGIN);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Логируем тело запроса ДО парсинга JSON
    console.log("[create-invoice] Received request body (raw):", event.body);

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) { /* ... 401 ... */ }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) { /* ... 401 ... */ }
    const tgUserId = validationResult.data.id;
    console.log(`[create-invoice] Request validated for user: ${tgUserId}`);

    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
        console.log("[create-invoice] Parsed request body:", requestBody); // Логируем распарсенное тело
    } catch (e) { /* ... 400 ... */ }

    const { plan, duration, amount, payload } = requestBody;
    if (!plan || !duration || !amount || !payload || typeof amount !== 'number' || amount <= 0) {
        console.error(`[create-invoice] Invalid request parameters for user ${tgUserId}:`, requestBody);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters' }) };
    }

    if (!BOT_TOKEN) { /* ... 500 ... */ }

    // --- Попытка создать ссылку ---
    let api; // Объявим заранее
    try {
        api = new Api(BOT_TOKEN);
        const title = `Подписка ${plan} (${duration} мес.)`;
        const description = `Оплата подписки ${plan} на ${duration} месяца в Dream Analyzer`;
        const currency = 'XTR';
        const prices = [{ label: `Подписка ${plan} ${duration} мес.`, amount: amount }];

        // Логируем ПЕРЕД вызовом API
        console.log(`[create-invoice] Attempting to call api.raw.createInvoiceLink for user ${tgUserId} with payload: ${payload}, amount: ${amount}`);

        const invoiceLink = await api.raw.createInvoiceLink({
            title, description, payload, currency, prices,
        });

        // Логируем ПОСЛЕ успешного вызова API
        console.log(`[create-invoice] Successfully created invoice link for user ${tgUserId}:`, invoiceLink);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceUrl: invoiceLink })
        };

    } catch (error) {
        // Логируем ошибку ПОДРОБНО
        console.error(`[create-invoice] Error during createInvoiceLink call for user ${tgUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        let statusCode = 500;

        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
            // Ошибки 4xx от Telegram - это ошибки клиента (неверные параметры)
            if (error.error_code >= 400 && error.error_code < 500) {
                 statusCode = 400; // Возвращаем Bad Request
                 errorMessage = `Bad Request: ${error.description}`;
            }
        } else if (error.message) {
            // Другие ошибки (сеть, таймауты и т.д.)
            errorMessage = error.message;
        }

        return {
            statusCode: statusCode, // Используем определенный статус
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
