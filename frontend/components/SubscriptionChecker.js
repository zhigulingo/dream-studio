import { useState, useEffect } from 'react';
import axios from 'axios';

export default function SubscriptionChecker({ userId }) {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('Запрос подписки для userId:', userId);
    axios.get(`https://sparkling-cupcake-940504.netlify.app/api/users/${userId}`)
      .then(response => {
        console.log('Данные подписки получены:', response.data);
        setSubscription(response.data);
      })
      .catch(err => {
        console.error('Ошибка получения подписки:', err.message);
        if (err.response) {
          console.error('Ответ сервера:', err.response.data);
          console.error('Статус:', err.response.status);
        }
        setError('Не удалось загрузить информацию о подписке. Попробуйте позже.');
      });
  }, [userId]);

  if (error) {
    return <p style={{ color: 'red' }}>{error}</p>;
  }

  if (!subscription) {
    return <p>Проверка подписки...</p>;
  }

  return (
    <div style={{ padding: '15px', backgroundColor: '#ffffff', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Ваш тариф: {subscription.subscription_type}</h3>
      <p style={{ margin: 0 }}>Осталось токенов: {subscription.tokens}</p>
    </div>
  );
}
