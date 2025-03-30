const { createClient } = require("@supabase/supabase-js");
const { validate: uuidValidate } = require('uuid'); // Для валидации UUID, если будете использовать Supabase Auth
const crypto = require('crypto'); // Для валидации initData

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN; // Нужен для валидации initData

// Функция валидации Telegram InitData (важно для безопасности!)
function validateTelegramData(initData, botToken) {
    if (!initData || !botToken) return { valid: false, data: null };

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, data: null };

    params.delete('hash'); // Удаляем hash из параметров для проверки
    const dataCheckArr = [];
    // Сортируем параметры по ключу для создания строки проверки
    params.sort();
    params.forEach((value, key) => dataCheckArr.push(`${key}=${value}`));
    const dataCheckString = dataCheckArr.join('\n');

    try {
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const checkHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (checkHash === hash) {
            // Хеш совпал, данные валидны. Парсим пользователя.
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


exports.handler = async (event) => {
    // Ожидаем GET запрос с initData в заголовке
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const initData = event.headers['x-telegram-init-data']; // Ожидаем initData в этом заголовке
    if (!initData) {
        return { statusCode: 401, body: 'Unauthorized: Missing Telegram InitData' };
    }

    // Валидируем initData
    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("Invalid or missing Telegram User Data after validation");
        return { statusCode: 401, body: 'Unauthorized: Invalid Telegram Data' };
    }

    const tgUserId = validationResult.data.id;
    console.log(`Fetching profile for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("Missing Supabase credentials");
        return { statusCode: 500, body: 'Internal Server Error: Configuration missing' };
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Ищем пользователя по tg_id
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('tokens, subscription_type, subscription_end') // Запрашиваем нужные поля
            .eq('tg_id', tgUserId)
            .maybeSingle(); // Используем maybeSingle, чтобы не было ошибки, если пользователь еще не создан ботом

        if (userError) {
            console.error(`Supabase error fetching user ${tgUserId}:`, userError);
            throw userError;
        }

        if (!userData) {
            // Можно вернуть дефолтные значения или ошибку 404
            console.log(`User profile not found for tg_id: ${tgUserId}. Returning default.`);
            return {
                statusCode: 200, // Или 404? Решите сами. 200 с дефолтом проще для фронта.
                body: JSON.stringify({
                    tokens: 0, // Или 1, если хотите дать токен при первом входе в TMA?
                    subscription_type: 'free',
                    subscription_end: null
                }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        console.log(`Profile found for tg_id ${tgUserId}:`, userData);
        return {
            statusCode: 200,
            body: JSON.stringify(userData),
            headers: { 'Content-Type': 'application/json' }
        };

    } catch (error) {
        console.error(`Error in user-profile function for tg_id ${tgUserId}:`, error);
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};
