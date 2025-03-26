const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getUser(tgId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('tg_id', tgId)
      .single();
    if (error) {
      console.error('Ошибка получения пользователя:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Не удалось подключиться к Supabase (getUser):', err.message);
    return null;
  }
}

async function createUser(tgId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .insert({ tg_id: tgId, subscription_type: 'trial', tokens: 1 })
      .select()
      .single();
    if (error) {
      console.error('Ошибка создания пользователя:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Не удалось подключиться к Supabase (createUser):', err.message);
    return null;
  }
}

async function createAnalysis(userId, dreamText, analysis) {
  try {
    const { data, error } = await supabase
      .from('analyses')
      .insert({ user_id: userId, dream_text: dreamText, analysis })
      .select()
      .single();
    if (error) {
      console.error('Ошибка создания анализа:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Не удалось подключиться к Supabase (createAnalysis):', err.message);
    return null;
  }
}

module.exports = { getUser, createUser, createAnalysis };
