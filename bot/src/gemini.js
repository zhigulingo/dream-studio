const axios = require('axios');

async function analyzeDream(dreamText) {
  try {
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}', // Замените на реальный URL Gemini API
      { text: dreamText },
      { headers: { 'Authorization': `Bearer ${process.env.GEMINI_API_KEY}` } }
    );
    return response.data.analysis || 'Анализ не удалось выполнить';
  } catch (error) {
    return 'Ошибка при анализе сна: ' + error.message;
  }
}

module.exports = { analyzeDream };
