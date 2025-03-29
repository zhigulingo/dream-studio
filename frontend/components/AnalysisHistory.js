import { useState, useEffect } from 'react';

export default function AnalysisHistory({ userId, maxItems }) {
  const [analyses, setAnalyses] = useState([]);
  const [error, setError] = useState(null);
  const [debugLog, setDebugLog] = useState('');

  useEffect(() => {
    const log = (message) => {
      setDebugLog((prev) => prev + message + '\n');
    };

    log(`Запрос истории анализов для userId: ${userId}`);
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      try {
        window.Telegram.WebApp.sendData('/get_analyses');
        log('Команда /get_analyses отправлена боту');
        setTimeout(() => {
          setError('Проверьте чат с ботом для получения истории анализов.');
        }, 2000);
      } catch (err) {
        log('Ошибка отправки команды: ' + err.message);
        setError('Не удалось запросить историю анализов. Попробуйте позже.');
      }
    } else {
      log('Telegram Web App не доступен');
      setError('Telegram Web App не доступен.');
    }
  }, [userId, maxItems]);

  return (
    <div style={{ padding: '15px', backgroundColor: '#ffffff', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>История анализов</h3>
      {error ? (
        <>
          <p style={{ color: 'red' }}>{error}</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugLog}
          </pre>
        </>
      ) : analyses.length === 0 ? (
        <>
          <p>История анализов пуста.</p>
          <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' }}>
            {debugLog}
          </pre>
        </>
      ) : (
        analyses.map((analysis, index) => (
          <div key={index} style={{ marginBottom: '15px', paddingBottom: '10px', borderBottom: '1px solid #eee' }}>
            <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>Сон: {analysis.dream_text}</p>
            <p style={{ margin: '0 0 5px 0' }}>Анализ: {analysis.analysis}</p>
            <p style={{ margin: 0, color: '#666', fontSize: '0.9em' }}>
              Дата: {new Date(analysis.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
