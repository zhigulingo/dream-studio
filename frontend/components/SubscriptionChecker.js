import { useState, useEffect } from 'react';
import axios from 'axios';

export default function SubscriptionChecker({ userId, onChangeTariff }) {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState(null);
  const [debugLog, setDebugLog] = useState('');

  useEffect(() => {
    const log = (message) => {
      setDebugLog((prev) => prev + message + '\n');
    };

    log(`Запрос подписки для userId: ${userId}`);
    axios
      .get(`https://tourmaline-eclair-9d40ea.netlify.app/proxy/user`, {
        params: { tgId: userId },
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      })
      .then((response) => {
        log('Данные подписки получены: ' + JSON.stringify(response.data));
        setSubscription(response.data);
      })
      .catch((err) => {
        log('Ошибка получения подписки: ' + err.message);
        if (err.response) {
          log('Ответ сервера: ' + JSON.stringify(err.response.data));
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
          <h3 style={{ margin: '0 0 10px 0' }}>
            Ваш тариф: {subscription.subscription_type} | Токенов: {subscription.tokens}
          </h3>
          <button
            onClick={onChangeTariff}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Изменить тариф
          </button>
        </>
      )}
    </div>
  );
}
