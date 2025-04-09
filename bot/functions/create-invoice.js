// bot/functions/create-invoice.js (Исправлено: без внешних библиотек, без provider_token для Stars)
const { Api, GrammyError } = require('grammy');
const crypto = require('crypto'); // Используем встроенный crypto

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
     if (!BOT_TOKEN || !ALLOWED_TMA_ORIGIN) { // Убрали проверку Supabase, т.к. здесь не используется
        console.error("[create-invoice] Server configuration missing (Bot Token or Allowed Origin)");
        return { statusCode: 500, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ error: 'Internal Server Error: Bot configuration missing.' }) };
     }

    // --- Валидация InitData с использованием ВАШЕЙ функции ---
    const initDataHeader = event.headers['x-telegram-init-data'];
    let verifiedUserId;

    if (!initDataHeader) {
        console.warn("[create-invoice] Unauthorized: Missing Telegram InitData header");
        return { statusCode: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized: Missing Telegram InitData' }) };
    }

    const validationResult = validateTelegramData(initDataHeader, BOT_TOKEN);

     if (!validationResult.valid) {
         console.error(`[create-invoice] InitData validation failed: ${validationResult.error}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Invalid Telegram InitData (${validationResult.error})` }) };
    }
    if (!validationResult.data || typeof validationResult.data.id === 'undefined') {
         console.error(`[create-invoice] InitData is valid, but user data/ID is missing or failed to parse: ${validationResult.error}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Forbidden: Could not extract user data from InitData (${validationResult.error})` }) };
    }

    verifiedUserId = validationResult.data.id;
    console.log(`[create-invoice] Access validated for user: ${verifiedUserId}`);


    // --- Получение и валидация данных из тела запроса ---
    let requestBody;
    try {
        if (!event.body) throw new Error('Missing request body');
        requestBody = JSON.parse(event.body);
        console.log(`[create-invoice] Parsed request body for user ${verifiedUserId}:`, requestBody);
    } catch (e) {
        console.error(`[create-invoice] Failed to parse JSON body for user ${verifiedUserId}:`, e.message);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Bad Request: ${e.message}` }) };
    }

    const { plan, duration, amount, payload } = requestBody;

    // Валидация: amount для Stars должен быть целым числом >= 1
    if (!plan || typeof plan !== 'string' || !duration || typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0 || !amount || typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || !payload || typeof payload !== 'string') {
        console.error(`[create-invoice] Invalid request parameters for user ${verifiedUserId}:`, requestBody);
        return { statusCode: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Bad Request: Missing or invalid parameters (plan[string], duration[int>0], amount[int>=1 for Stars], payload[string])' }) };
    }

    // Проверка совпадения ID в payload и проверенного ID
    const payloadParts = payload.split('_');
    const payloadUserId = payloadParts.length > 3 ? parseInt(payloadParts[3], 10) : null;
    if (payloadUserId !== verifiedUserId) {
         console.error(`[create-invoice] Security Alert: Payload user ID (${payloadUserId}) does not match validated InitData user ID (${verifiedUserId}). Payload: ${payload}`);
         return { statusCode: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden: User ID mismatch' }) };
    }
    console.log(`[create-invoice] Payload user ID matches validated user ID for ${verifiedUserId}.`);


    // --- Создание ссылки на инвойс для Telegram Stars ---
    let api;
    try {
        api = new Api(BOT_TOKEN);

        const title = `Подписка ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${duration} мес.)`;
        const description = `Оплата подписки "${plan}" на ${duration} месяца в Dream Analyzer за Telegram Stars`;
        const currency = 'XTR'; // Для Stars используется XTR
        // Убедитесь, что amount передается как целое число звезд
        const prices = [{ label: `Подписка ${plan} ${duration} мес.`, amount: amount }]; // amount в XTR

        console.log(`[create-invoice] Attempting to call api.raw.createInvoiceLink (for Stars) for user ${verifiedUserId} with payload ${payload}...`);
        const invoiceLink = await api.raw.createInvoiceLink({
            title,
            description,
            payload,
            currency, // XTR
            prices
            // provider_token НЕ нужен для XTR (Stars)
        });
        console.log(`[create-invoice] Successfully created invoice link (Stars) for user ${verifiedUserId}.`);

        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceUrl: invoiceLink })
        };

    } catch (error) {
        console.error(`[create-invoice] Error during createInvoiceLink call (Stars) for user ${verifiedUserId}:`, error);
        let errorMessage = 'Internal Server Error: Failed to create invoice link.';
        let statusCode = 500;

        if (error instanceof GrammyError) {
            errorMessage = `Telegram API Error: ${error.description} (Code: ${error.error_code})`;
            if (error.error_code >= 400 && error.error_code < 500) {
                 statusCode = 400;
                 errorMessage = `Bad Request to Telegram API: ${error.description}`;
            }
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            statusCode: statusCode,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
