import { useState, useEffect } from 'react';

const quotes = [
  "Сны — это мост между реальностью и подсознанием.",
  "Каждый сон несет в себе скрытый смысл, который ждет расшифровки.",
  "Твои сны — это зеркало твоей души."
];

export default function QuoteCarousel() {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentQuoteIndex((prevIndex) => (prevIndex + 1) % quotes.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '10px', textAlign: 'center', backgroundColor: '#f0f0f0', borderRadius: '8px', marginBottom: '20px' }}>
      <p>{quotes[currentQuoteIndex]}</p>
    </div>
  );
}
