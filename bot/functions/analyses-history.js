const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Скопируйте сюда функцию validateTelegramData из user-profile.js ---
function validateTelegramData(initData, botToken) {
    // ... (полный код функции валидации)
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
// --- Конец функции валидации ---

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const initData = event.headers['x-telegram-init-data'];
    if (!initData) {
        return { statusCode: 401, body: 'Unauthorized: Missing Telegram InitData' };
    }

    const validationResult = validateTelegramData(initData, BOT_TOKEN);
    if (!validationResult.valid || !validationResult.data?.id) {
        console.error("Invalid or missing Telegram User Data after validation");
        return { statusCode: 401, body: 'Unauthorized: Invalid Telegram Data' };
    }

    const tgUserId = validationResult.data.id;
    console.log(`Fetching history for validated tg_id: ${tgUserId}`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("Missing Supabase credentials");
        return { statusCode: 500, body: 'Internal Server Error: Configuration missing' };
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // 1. Найти ID пользователя в таблице users по tg_id
        const { data: user, error: userFindError } = await supabase
            .from('users')
            .select('id')
            .eq('tg_id', tgUserId)
            .single(); // Ожидаем одного пользователя

        if (userFindError || !user) {
            console.error(`User not found in 'users' table for tg_id ${tgUserId}:`, userFindError);
            // Если пользователя нет в users, у него не может быть истории
            return { statusCode: 200, body: JSON.stringify([]), headers: { 'Content-Type': 'application/json' } };
        }

        const userDbId = user.id;

        // 2. Получить историю анализов для этого user_id
        const { data: history, error: historyError } = await supabase
            .from('analyses')
            .select('id, dream_text, analysis, created_at') // Выбираем нужные поля
            .eq('user_id', userDbId) // Фильтруем по ID пользователя из таблицы users
            .order('created_at', { ascending: false }) // Сортируем по дате, новые сверху
            .limit(50); // Ограничиваем количество для начала

        if (historyError) {
            console.error(`Supabase error fetching history for user_id ${userDbId}:`, historyError);
            throw historyError;
        }

        console.log(`History fetched for user_id ${userDbId}. Count: ${history?.length ?? 0}`);
        return {
            statusCode: 200,
            body: JSON.stringify(history || []), // Возвращаем массив истории или пустой массив
            headers: { 'Content-Type': 'application/json' }
        };

    } catch (error) {
        console.error(`Error in analyses-history function for tg_id ${tgUserId}:`, error);
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};
