import { useState, useEffect } from 'react';
import axios from 'axios';

export default function SubscriptionChecker({ userId }) {
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    if (userId) {
      axios.get(`https://sparkling-cupcake-940504.netlify.app/api/users/${userId}`)
        .then(response => setSubscription(response.data))
        .catch(error => console.error('Error fetching subscription:', error));
    }
  }, [userId]);

  return (
    <div style={{ padding: '10px', backgroundColor: '#e0e0e0', borderRadius: '8px', marginBottom: '20px' }}>
      {subscription ? (
        <p>Ваш тариф: {subscription.subscription_type}, токенов осталось: {subscription.tokens}</p>
      ) : (
        <p>Проверка подписки...</p>
      )}
    </div>
  );
}
