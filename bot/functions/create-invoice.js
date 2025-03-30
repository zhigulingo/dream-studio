// bot/functions/create-invoice.js
const { Api, GrammyError } = require('grammy'); // Используем Api из grammy
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const TMA_ORIGIN = process.env.TMA_URL;
// Нужен токен провайдера платежей Telegram (получается у @BotFather при подключении провайдера)
// Если используете Telegram Stars, токен не нужен, но API может требовать заглушку.
// Для Stars ВАЖНА валюта "XTR" и provider_token можно не указывать или использовать фиктивный.
const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || "dummy_token_for_stars"; // Замените, если используете другого провайдера

// --- Функция валидации Telegram InitData ---
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
const generateCorsHeaders = (allowedOrigin) => {
    // Возвращаем к использованию TMA_ORIGIN для безопасности
    const originToAllow = allowedOrigin || '*'; // Можно оставить '*' если TMA_URL не задан
    console.log(`CORS: Allowing origin: ${originToAllow}`);
    return {
        'Access-Control-Allow-Origin': originToAllow,
        'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
         // Теперь нужен POST
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
        return {
            statusCode: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Валидация InitData ---
    const initData = event.headers['x-telegram-init-data'];
    if (!initData) { /* ... обработка ошибки 401 ... */
         return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) { /* ... обработка ошибки 401 ... */
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Invalid Telegram Data' }) };
    }
    const tgUserId = validationResult.data.id; // Получаем ID пользователя

    // --- Получение данных из тела запроса ---
    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Invalid JSON body' }) };
    }

    const { plan, duration, amount, payload } = requestBody;

    // Простая валидация входных данных
    if (!plan || !duration || !amount || !payload || typeof amount !== 'number' || amount <= 0) {
         console.error("Invalid request body:", requestBody);
         return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters' }) };
    }

    // --- Создание ссылки на инвойс через Telegram Bot API ---
    if (!BOT_TOKEN) { /* ... обработка ошибки 500 ... */ }

    try {
        const api = new Api(BOT_TOKEN); // Создаем экземпляр API grammy
        console.log(`Creating invoice link: User=${tgUserId}, Plan=${plan}, Duration=${duration}, Amount=${amount} Stars, Payload=${payload}`);

        const invoiceLink = await api.raw.createInvoiceLink({
            title: `Подписка ${plan.toUpperCase()} (${duration} мес.)`,
            description: `Оплата подписки ${plan} на ${duration} месяца в Dream Analyzer`,
            payload: payload, // Строка, которую получит бот при успешной оплате
            // provider_token: PAYMENT_PROVIDER_TOKEN, // Не указываем для Stars или используем фиктивный
            currency: 'XTR', // Валюта Telegram Stars
            prices: [
                // Массив цен - должен быть один элемент для простого платежа
                { label: `Подписка ${plan} ${duration} мес.`, amount: amount } // amount в минимальных единицах валюты (для Stars это и есть количество звезд)
            ],
            // Опциональные параметры:
            // need_name: true,
            // need_phone_number: true,
            // need_email: true,
            // need_shipping_address: false,
            // send_phone_number_to_provider: false,
            // send_email_to_provider: false,
            // is_flexible: false, // true, если нужна обработка shipping_query
        });

        console.log("Invoice link created successfully:", invoiceLink);

        // Возвращаем ссылку фронтенду
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceUrl: invoiceLink }) // Telegram API возвращает просто строку URL
        };

    } catch (error) {
        console.error(`Error creating invoice link for user ${tgUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
        }
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
