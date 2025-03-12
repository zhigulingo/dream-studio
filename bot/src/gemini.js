const axios = require('axios');

async function analyzeDream(dreamText) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              {
                text: `Проанализируй сон: ${dreamText}. Расшифруй ключевые символы, выяви скрытые паттерны и дай рекомендации.`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Извлекаем текст ответа из структуры Gemini API
    const analysis = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Анализ не удалось выполнить';
    return analysis;
  } catch (error) {
    console.error('Error in Gemini API request:', error.response?.data || error.message);
    return 'Ошибка при анализе сна: ' + (error.response?.data?.error?.message || error.message);
  }
}

module.exports = { analyzeDream };
