const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

exports.handler = async (event) => {
  const { path, queryStringParameters } = event;
  const tgId = queryStringParameters?.tgId;

  if (!tgId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'tgId is required' }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }

  try {
    if (path.includes('/user')) {
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('tg_id', tgId)
        .single();
      if (error) throw error;
      return {
        statusCode: 200,
        body: JSON.stringify(user),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      };
    } else if (path.includes('/analyses')) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, subscription_type')
        .eq('tg_id', tgId)
        .single();
      if (userError) throw userError;

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

      const { data: analyses, error } = await query;
      if (error) throw error;

      return {
        statusCode: 200,
        body: JSON.stringify(analyses),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      };
    } else {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Not found' }),
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      };
    }
  } catch (err) {
    console.error('Ошибка прокси:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
};
