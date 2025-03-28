import { useState, useEffect } from 'react';
import axios from 'axios';

export default function SubscriptionChecker({ userId }) {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState(null);
  const [debugLog, setDebugLog] = useState('');

  useEffect(() => {
    const log = (message) => {
      setDebugLog((prev) => prev + message + '\n');
    };

    log(`Запрос подписки для userId: ${userId}`);
    axios.get(`https://sparkling-cupcake-940504.netlify.app/api/users/${userId}`)
      .then(response => {
        log('Данные подписки получены: ' + JSON.stringify(response.data));
        setSubscription(response.data);
      })
      .catch(err => {
        log('Ошибка получения подписки: ' + err.message);
        if (err.response) {
          log('Ответ сервера: ' + JSON.stringify(err.response.data));
          log('Статус: ' + err.response.status);
        }
        setError('Не удалось загрузить информацию о подписке. Попробуйте позже.');
      });
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
