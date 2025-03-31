// bot/functions/create-invoice.js (Упрощенный)
const { Api, GrammyError } = require('grammy');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
// TMA_ORIGIN здесь больше не нужен

function validateTelegramData(initData, botToken) { /* ... код ... */ } // Код валидации без изменений

exports.handler = async (event) => {
    // --- Убрана обработка OPTIONS и генерация CORS ---

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }), headers: { 'Content-Type': 'application/json' } };
    }

    console.log("[create-invoice] Received request body (raw):", event.body); // Оставляем для отладки

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) { /* ... return 401 ... */ }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) { /* ... return 401 ... */ }
    const tgUserId = validationResult.data.id;
    console.log(`[create-invoice] Request validated for user: ${tgUserId}`);

    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
        console.log("[create-invoice] Parsed request body:", requestBody);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Bad Request: Invalid JSON body' }), headers: { 'Content-Type': 'application/json' } };
    }

    const { plan, duration, amount, payload } = requestBody;
    if (!plan || !duration || !amount || !payload || typeof amount !== 'number' || amount <= 0) {
         console.error(`[create-invoice] Invalid request parameters for user ${tgUserId}:`, requestBody);
        return { statusCode: 400, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters' }), headers: { 'Content-Type': 'application/json' } };
    }

    if (!BOT_TOKEN) {
         console.error("[create-invoice] FATAL: BOT_TOKEN is missing!");
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }), headers: { 'Content-Type': 'application/json' } };
     }

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
            // Заголовки добавит Netlify
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
            // Заголовки добавит Netlify
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
