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
      try {
        window.Telegram.WebApp.sendData('/get_subscription');
        log('Команда /get_subscription отправлена боту');
        // Мы не можем напрямую получить ответ от бота, поэтому пользователь увидит его в чате
        setTimeout(() => {
          setError('Проверьте чат с ботом для получения информации о подписке.');
        }, 2000);
      } catch (err) {
        log('Ошибка отправки команды: ' + err.message);
        setError('Не удалось запросить информацию о подписке. Попробуйте позже.');
      }
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
      ) : subscription ? (
        <>
          <h3 style={{ margin: '0 0 10px 0' }}>Ваш тариф: {subscription.subscription_type}</h3>
          <p style={{ margin: 0 }}>Осталось токенов: {subscription.tokens}</p>
        </>
      ) : (
        <>
          <p>Проверка подписки...</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugLog}
          </pre>
        </>
      )}
    </div>
  );
}
