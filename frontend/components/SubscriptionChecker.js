import { useState, useEffect } from 'react';

export default function SubscriptionChecker({ userId }) {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState(null);
  const [debugLog, setDebugLog] = useState('');

  useEffect(() => {
    const log = (message) => {
      setDebugLog((prev) => prev + message + '\n');
    };

    log(`Запрос подписки для userId: ${userId}`);
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const query = `fetch:/users/${userId}`;
      log(`Отправка запроса: ${query}`);

      window.Telegram.WebApp.sendData(query);

      const handler = (event) => {
        log('Получено событие от Telegram: ' + JSON.stringify(event));
        if (event.data) {
          try {
            const response = JSON.parse(event.data);
            if (response.error) {
              log('Ошибка от бота: ' + response.error);
              setError('Не удалось загрузить информацию о подписке: ' + response.error);
            } else {
              log('Данные подписки получены: ' + JSON.stringify(response));
              setSubscription(response);
            }
          } catch (err) {
            log('Ошибка парсинга ответа: ' + err.message);
            setError('Ошибка обработки данных о подписке.');
          }
        }
      };

      window.Telegram.WebApp.onEvent('web_app_data', handler);

      return () => {
        window.Telegram.WebApp.offEvent('web_app_data', handler);
      };
    } else {
      log('Telegram Web App не доступен');
      setError('Telegram Web App не доступен.');
    }
  }, [userId]);

  return (
    <div style={{ padding: '15px', backgroundColor: '#ffffff', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)', marginBottom: '20px' }}>
      {error ? (
        <>
          <p style={{ color: 'red' }}>{error}</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugLog}
          </pre>
        </>
      ) : !subscription ? (
        <>
          <p>Проверка подписки...</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugLog}
          </pre>
        </>
      ) : (
        <>
          <h3 style={{ margin: '0 0 10px 0' }}>Ваш тариф: {subscription.subscription_type}</h3>
          <p style={{ margin: 0 }}>Осталось токенов: {subscription.tokens}</p>
        </>
      )}
    </div>
  );
}
