import { useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';
import QuoteCarousel from '../components/QuoteCarousel';
import SubscriptionChecker from '../components/SubscriptionChecker';
import AnalysisHistory from '../components/AnalysisHistory';

export default function Home() {
  const { user, isClient, error, debugInfo } = useTelegram();
  const [selectedTariff, setSelectedTariff] = useState('basic');
  const [selectedDuration, setSelectedDuration] = useState('3');
  const [showTariffModal, setShowTariffModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const tariffs = {
    trial: {
      name: 'Trial',
      features: ['1 токен', 'История: 1 сон (24 часа)'],
      pricing: {
        '1': 0,
        '3': 0,
        '12': 0,
      },
    },
    basic: {
      name: 'Basic',
      features: ['15 токенов', 'История: 3 сна'],
      pricing: {
        '1': 1,
        '3': 2,
        '12': 5,
      },
    },
    premium: {
      name: 'Premium',
      features: ['30 токенов', 'История: 5 снов'],
      pricing: {
        '1': 2,
        '3': 4,
        '12': 10,
      },
    },
  };

  const durations = [
    { value: '1', label: '1 месяц' },
    { value: '3', label: '3 месяца' },
    { value: '12', label: '12 месяцев' },
  ];

  const getMaxItems = (subscriptionType) => {
    switch (subscriptionType) {
      case 'trial': return 1;
      case 'basic': return 3;
      case 'premium': return 5;
      default: return 1;
    }
  };

  const handleTariffChange = () => {
    setShowTariffModal(true);
  };

  const handleConfirmTariff = () => {
    setShowTariffModal(false);
    setShowPaymentModal(true);
  };

  const handlePayment = () => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const stars = tariffs[selectedTariff].pricing[selectedDuration];
      window.Telegram.WebApp.openInvoice(
        `Тариф ${tariffs[selectedTariff].name} на ${selectedDuration} месяцев`,
        `Получите ${tariffs[selectedTariff].features[0]} за ${stars} Stars`,
        JSON.stringify({ tariff: selectedTariff, duration: selectedDuration, tgId: user.id }),
        'XTR',
        [{ label: `Тариф ${selectedTariff}`, amount: stars }],
        (status) => {
          if (status === 'paid') {
            alert('Оплата прошла успешно!');
            setShowPaymentModal(false);
            // Здесь можно обновить данные пользователя через Supabase
          } else if (status === 'cancelled') {
            alert('Оплата отменена');
            setShowPaymentModal(false);
          } else if (status === 'failed') {
            alert('Ошибка оплаты');
            setShowPaymentModal(false);
          }
        }
      );
    } else {
      alert('Telegram Web App не доступен для оплаты');
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
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto', position: 'relative' }}>
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
          <SubscriptionChecker userId={user.id} onChangeTariff={handleTariffChange} />
          <AnalysisHistory userId={user.id} maxItems={getMaxItems(user.subscription_type)} />
        </>
      ) : (
        <>
          <p>Загрузка данных пользователя...</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugInfo}
          </pre>
        </>
      )}

      {/* Модальное окно выбора тарифа */}
      {showTariffModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#1c2526',
              padding: '20px',
              borderRadius: '10px',
              width: '90%',
              maxWidth: '400px',
              color: 'white',
            }}
          >
            <h2 style={{ textAlign: 'center' }}>Выберите тариф</h2>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '20px' }}>
              {Object.keys(tariffs).map((tariff) => (
                <button
                  key={tariff}
                  onClick={() => setSelectedTariff(tariff)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: selectedTariff === tariff ? '#007bff' : '#444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                  }}
                >
                  {tariffs[tariff].name}
                </button>
              ))}
            </div>
            <div style={{ marginBottom: '20px' }}>
              <h3>Опции:</h3>
              <ul>
                {tariffs[selectedTariff].features.map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <h3>Длительность:</h3>
              {durations.map((duration) => (
                <div key={duration.value} style={{ marginBottom: '10px' }}>
                  <label>
                    <input
                      type="radio"
                      name="duration"
                      value={duration.value}
                      checked={selectedDuration === duration.value}
                      onChange={(e) => setSelectedDuration(e.target.value)}
                    />
                    {duration.label} - {tariffs[selectedTariff].pricing[duration.value]} Stars
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={() => setShowTariffModal(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmTariff}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                }}
              >
                Далее
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно оплаты */}
      {showPaymentModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#1c2526',
              padding: '20px',
              borderRadius: '10px',
              width: '90%',
              maxWidth: '400px',
              color: 'white',
              textAlign: 'center',
            }}
          >
            <h2>Подтвердите покупку</h2>
            <p>
              Вы хотите оформить подписку <strong>{tariffs[selectedTariff].name}</strong> на{' '}
              <strong>{selectedDuration} месяцев</strong> за{' '}
              <strong>{tariffs[selectedTariff].pricing[selectedDuration]} Stars</strong>?
            </p>
            <button
              onClick={handlePayment}
              style={{
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                marginTop: '20px',
                width: '100%',
              }}
            >
              Подтвердить и оплатить ★ {tariffs[selectedTariff].pricing[selectedDuration]}
            </button>
            <p style={{ marginTop: '10px', fontSize: '0.8em', color: '#aaa' }}>
              Покупая, вы соглашаетесь с Условиями использования.
            </p>
            <button
              onClick={() => setShowPaymentModal(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'none',
                border: 'none',
                color: 'white',
                fontSize: '1.2em',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
