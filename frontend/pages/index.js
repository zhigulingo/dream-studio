import { useTelegram } from '../hooks/useTelegram';
import QuoteCarousel from '../components/QuoteCarousel';
import SubscriptionChecker from '../components/SubscriptionChecker';
import AnalysisHistory from '../components/AnalysisHistory';

export default function Home() {
  const { user, isClient, error, debugInfo } = useTelegram();

  const getMaxItems = (subscriptionType) => {
    switch (subscriptionType) {
      case 'trial': return 1;
      case 'basic': return 3;
      case 'premium': return 5;
      default: return 1;
    }
  };

  const handleShowTariffs = () => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.showPopup(
        {
          title: 'Тарифы',
          message: 'Выберите тариф:\nBasic: 15 токенов (1 Star)\nPremium: 30 токенов (1 Star)',
          buttons: [
            { id: 'basic', type: 'default', text: 'Basic' },
            { id: 'premium', type: 'default', text: 'Premium' },
            { type: 'cancel' },
          ],
        },
        (buttonId) => {
          if (buttonId === 'basic' || buttonId === 'premium') {
            try {
              window.Telegram.WebApp.sendData(buttonId);
              alert(`Тариф ${buttonId} выбран и отправлен боту!`);
            } catch (err) {
              alert('Ошибка отправки тарифа: ' + err.message);
            }
          } else {
            alert('Выбор тарифа отменен');
          }
        }
      );
    } else {
      alert('Telegram Web App не доступен для показа поп-апа');
    }
  };

  if (!isClient) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        <h1>Добро пожаловать в Dream Analyzer</h1>
        <p>Инициализация...</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Добро пожаловать в Dream Analyzer</h1>
      {error ? (
        <>
          <p style={{ color: 'red' }}>Ошибка: {error}</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugInfo}
          </pre>
        </>
      ) : user ? (
        <>
          <QuoteCarousel />
          <SubscriptionChecker userId={user.id} />
          <AnalysisHistory userId={user.id} maxItems={getMaxItems(user.subscription_type)} />
          <button
            onClick={handleShowTariffs}
            style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Сравнить тарифы
          </button>
          <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
            <h3>Логи (для отладки):</h3>
            <p>Логи отображаются в консоли браузера. Если вы на мобильном устройстве, обратитесь к разработчику за помощью.</p>
          </div>
        </>
      ) : (
        <>
          <p>Загрузка данных пользователя...</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugInfo}
          </pre>
        </>
      )}
    </div>
  );
}
