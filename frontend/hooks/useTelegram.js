import { useEffect, useState } from 'react';

export function useTelegram() {
  const [user, setUser] = useState(null);
  const [initData, setInitData] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState('');

  useEffect(() => {
    setIsClient(true);
    setDebugInfo('useEffect сработал, проверяем окружение...');

    if (typeof window === 'undefined') {
      setError('Окружение не является браузером');
      setDebugInfo((prev) => prev + '\nОкружение не является браузером');
      return;
    }

    setDebugInfo((prev) => prev + '\nОкружение — браузер, проверяем Telegram SDK...');

    if (!window.Telegram) {
      setError('Telegram Web App SDK не загружен');
      setDebugInfo((prev) => prev + '\nTelegram Web App SDK не загружен');
      return;
    }

    setDebugInfo((prev) => prev + '\nTelegram SDK найден, инициализируем...');

    const tg = window.Telegram.WebApp;
    if (!tg) {
      setError('Telegram Web App не инициализирован');
      setDebugInfo((prev) => prev + '\nTelegram Web App не инициализирован');
      return;
    }

    try {
      tg.ready();
      setDebugInfo((prev) => prev + '\ntg.ready() вызван, получаем данные пользователя...');
      const userData = tg.initDataUnsafe.user;
      if (!userData) {
        setError('Данные пользователя не получены');
        setDebugInfo((prev) => prev + '\nДанные пользователя не получены');
      } else {
        setUser(userData);
        setInitData(tg.initData);
        setDebugInfo((prev) => prev + '\nПользователь успешно загружен: ' + JSON.stringify(userData));
      }
    } catch (err) {
      setError('Ошибка инициализации Telegram Web App: ' + err.message);
      setDebugInfo((prev) => prev + '\nОшибка инициализации: ' + err.message);
    }
  }, []);

  return { user, initData, isClient, error, debugInfo };
}
