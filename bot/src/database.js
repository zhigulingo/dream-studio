const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getUser(tgId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('tg_id', tgId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({ tg_id: tgId, subscription_type: 'trial', tokens: 1 })
      .select()
      .single();
    return newUser;
  }
  return data;
}

async function updateUserTokens(userId, tokens) {
  const { error } = await supabase
    .from('users')
    .update({ tokens })
    .eq('id', userId);
  if (error) throw error;
}

async function storeAnalysis(userId, dreamText, analysis) {
  const { error } = await supabase
    .from('analyses')
    .insert({ user_id: userId, dream_text: dreamText, analysis });
  if (error) throw error;
}

module.exports = { getUser, updateUserTokens, storeAnalysis };
