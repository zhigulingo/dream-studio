// bot/functions/create-invoice.js
const { Api, GrammyError } = require('grammy'); // Используем Api из grammy
const crypto = require('crypto');

// --- Переменные окружения ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const TMA_ORIGIN = process.env.TMA_URL; // URL вашего TMA для CORS

// --- Функция валидации Telegram InitData ---
// (Скопируйте ее из user-profile.js или analyses-history.js)
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
        } else {
            console.warn("[create-invoice] Telegram InitData validation failed: hash mismatch.");
            return { valid: false, data: null };
        }
    } catch (error) {
        console.error("[create-invoice] Error during Telegram InitData validation:", error);
        return { valid: false, data: null };
    }
}

// --- Заголовки CORS (Разрешаем POST с вашего TMA) ---
const generateCorsHeaders = (allowedOrigin) => {
    // Используем TMA_URL для безопасности
    const originToAllow = allowedOrigin; // Не используем '*', если TMA_URL задан
    console.log(`[create-invoice] CORS: Checking origin. Allowed: ${originToAllow || 'Not Set!'}`);
    // Если TMA_URL не задан в переменных окружения, CORS не сработает!
    if (!originToAllow) {
         console.error("[create-invoice] FATAL: TMA_URL environment variable is not set. CORS will fail.");
         // Можно вернуть заголовки с ошибкой или пустые, но лучше исправить переменные.
    }
    return {
        // В продакшене строго указывайте ваш TMA_URL
        'Access-Control-Allow-Origin': originToAllow || '*', // Ставим * только если TMA_URL не задан (для ОТЛАДКИ)
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
        'Access-Control-Allow-Methods': 'POST, OPTIONS', // Разрешаем POST
    };
};

exports.handler = async (event) => {
    const corsHeaders = generateCorsHeaders(TMA_ORIGIN);

    // --- Обработка Preflight запроса (OPTIONS) ---
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // --- Ожидаем POST запрос ---
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Валидация InitData ---
    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
         return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }) };
    }
    const tgUserId = validationResult.data.id;

    // --- Получение данных из тела запроса ---
    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Invalid JSON body' }) };
    }

    const { plan, duration, amount, payload } = requestBody;

    // Валидация входных данных
    if (!plan || !duration || !amount || !payload || typeof amount !== 'number' || amount <= 0) {
         console.error(`[create-invoice] Invalid request body for user ${tgUserId}:`, requestBody);
         return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters' }) };
    }

    // --- Создание ссылки на инвойс через Telegram Bot API ---
    if (!BOT_TOKEN) {
         console.error("[create-invoice] FATAL: BOT_TOKEN is missing!");
         return { statusCode: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
    }

    try {
        const api = new Api(BOT_TOKEN);
        console.log(`[create-invoice] Creating invoice link: User=${tgUserId}, Plan=${plan}, Duration=${duration}, Amount=${amount} Stars, Payload=${payload}`);

        // --- Параметры для createInvoiceLink ---
        const title = `Подписка ${plan} (${duration} мес.)`;
        const description = `Оплата подписки ${plan} на ${duration} месяца в Dream Analyzer`;
        const currency = 'XTR'; // Валюта Telegram Stars
        const prices = [{ label: `Подписка ${plan} ${duration} мес.`, amount: amount }]; // amount - это и есть количество звезд

        const invoiceLink = await api.raw.createInvoiceLink({
            title: title,
            description: description,
            payload: payload,
            currency: currency,
            prices: prices,
            // provider_token можно не указывать для XTR
        });

        console.log(`[create-invoice] Invoice link created successfully for user ${tgUserId}:`, invoiceLink);

        // Возвращаем ссылку фронтенду
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceUrl: invoiceLink })
        };

    } catch (error) {
        console.error(`[create-invoice] Error creating invoice link for user ${tgUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
            // Можно добавить обработку специфических ошибок, например, лимитов
        }
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
