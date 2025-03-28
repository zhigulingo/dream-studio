const fastify = require('fastify')({ logger: true });
const { createClient } = require('@supabase/supabase-js');

console.log('Инициализация Supabase в api.js...');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'Установлен' : 'Не установлен');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Настройка CORS
fastify.register(require('@fastify/cors'), {
  origin: '*', // Разрешаем запросы от всех источников (для тестов)
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

fastify.get('/users/:tgId', async (request, reply) => {
  const { tgId } = request.params;
  console.log(`Запрос данных пользователя с tgId: ${tgId}`);
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('tg_id', tgId)
      .single();
    if (error) {
      console.error('Ошибка получения пользователя:', error);
      reply.status(500).send({ error: 'Не удалось получить пользователя' });
      return;
    }
    console.log('Пользователь найден:', data);
    return data;
  } catch (err) {
    console.error('Ошибка подключения к Supabase:', err.message);
    reply.status(500).send({ error: 'Ошибка подключения к базе данных' });
  }
});

fastify.get('/users/:tgId/analyses', async (request, reply) => {
  const { tgId } = request.params;
  console.log(`Запрос анализов для tgId: ${tgId}`);
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, subscription_type')
      .eq('tg_id', tgId)
      .single();
    if (userError) {
      console.error('Ошибка получения пользователя:', userError);
      reply.status(500).send({ error: 'Не удалось получить пользователя' });
      return;
    }

    let query = supabase
      .from('analyses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (user.subscription_type === 'trial') {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      query = query.gt('created_at', twentyFourHoursAgo);
    } else if (user.subscription_type === 'basic') {
      query = query.limit(3);
    } else if (user.subscription_type === 'premium') {
      query = query.limit(5);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Ошибка получения анализов:', error);
      reply.status(500).send({ error: 'Не удалось получить анализы' });
      return;
    }
    console.log('Анализы получены:', data);
    return data;
  } catch (err) {
    console.error('Ошибка подключения к Supabase:', err.message);
    reply.status(500).send({ error: 'Ошибка подключения к базе данных' });
  }
});

exports.handler = async (event, context) => {
  const { httpMethod, path, queryStringParameters, body } = event;
  const adjustedPath = path.replace(/^\/api/, '');
  console.log('Обработка запроса:', httpMethod, adjustedPath);
  const response = await fastify.inject({
    method: httpMethod,
    url: adjustedPath,
    query: queryStringParameters,
    payload: body,
  });
  return {
    statusCode: response.statusCode,
    body: response.payload,
  };
};
