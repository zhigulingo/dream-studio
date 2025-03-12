import { useEffect, useState } from 'react';

export function useTelegram() {
  const [user, setUser] = useState(null);
  const [initData, setInitData] = useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      setUser(tg.initDataUnsafe.user);
      setInitData(tg.initData);
    }
  }, []);

  return { user, initData };
}
