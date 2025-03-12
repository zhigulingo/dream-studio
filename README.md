# Dream Analyzer

Проект для анализа снов через Telegram-бот.

## Подпроекты
- `bot/`: Telegram-бот на Telegraf, развернутый через Netlify Functions.

## Настройка
1. Создайте таблицы в Supabase (см. SQL ниже).
2. Настройте переменные окружения в Netlify.
3. Установите вебхук для Telegram-бота.

## SQL для Supabase
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT UNIQUE NOT NULL,
  subscription_type VARCHAR(20) DEFAULT 'trial',
  tokens INT DEFAULT 1,
  subscription_end TIMESTAMP
);

CREATE TABLE analyses (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  dream_text TEXT NOT NULL,
  analysis TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
