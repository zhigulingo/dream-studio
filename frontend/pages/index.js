import { useTelegram } from '../hooks/useTelegram';
import QuoteCarousel from '../components/QuoteCarousel';
import SubscriptionChecker from '../components/SubscriptionChecker';
import AnalysisHistory from '../components/AnalysisHistory';

export default function Home() {
  const { user } = useTelegram();

  if (!window.Telegram) {
    console.error('Telegram Web App SDK не загружен');
  } else {
    console.log('Telegram Web App SDK загружен', window.Telegram.WebApp);
    console.log('Пользователь:', user);
  }

  const getMaxItems = (subscriptionType) => {
    switch (subscriptionType) {
      case 'trial': return 1;
      case 'basic': return 3;
      case 'premium': return 5;
      default: return 1;
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Добро пожаловать в Dream Analyzer</h1>
      {user ? (
        <>
          <QuoteCarousel />
          <SubscriptionChecker userId={user.id} />
          <AnalysisHistory userId={user.id} maxItems={getMaxItems(user.subscription_type)} />
          <button
            onClick={() => window.Telegram.WebApp.showPopup({
              title: 'Тарифы',
              message: 'Выберите тариф:\nTrial: 1 токен\nBasic: 15 токенов (30 Stars)\nPremium: 30 токенов (90 Stars)',
              buttons: [
                { id: 'basic', type: 'default', text: 'Basic' },
                { id: 'premium', type: 'default', text: 'Premium' },
                { type: 'cancel' }
              ]
            }, (buttonId) => {
              if (buttonId === 'basic' || buttonId === 'premium') {
                window.Telegram.WebApp.sendData(buttonId);
              }
            })}
            style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Сравнить тарифы
          </button>
        </>
      ) : (
        <p>Загрузка данных пользователя... Проверьте консоль для отладки.</p>
      )}
    </div>
  );
}
