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
    <div
      style={{
        padding: '15px',
        textAlign: 'center',
        backgroundColor: '#ffffff',
        borderRadius: '10px',
        boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)',
        marginBottom: '20px',
        minHeight: '100px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <p style={{ fontStyle: 'italic', color: '#333', margin: 0 }}>
        "{quotes[currentQuoteIndex]}"
      </p>
    </div>
  );
}
