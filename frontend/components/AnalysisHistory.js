import { useState, useEffect } from 'react';
import axios from 'axios';

export default function AnalysisHistory({ userId, maxItems }) {
  const [analyses, setAnalyses] = useState([]);

  useEffect(() => {
    if (userId) {
      axios.get(`https://sparkling-cupcake-940504.netlify.app/api/users/${userId}/analyses`)
        .then(response => setAnalyses(response.data.slice(0, maxItems)))
        .catch(error => console.error('Error fetching analyses:', error));
    }
  }, [userId, maxItems]);

  return (
    <div style={{ padding: '10px' }}>
      <h3>История анализов</h3>
      {analyses.length > 0 ? (
        <ul>
          {analyses.map(analysis => (
            <li key={analysis.id} style={{ marginBottom: '10px', borderBottom: '1px solid #ccc', paddingBottom: '5px' }}>
              <p><strong>Сон:</strong> {analysis.dream_text}</p>
              <p><strong>Анализ:</strong> {analysis.analysis}</p>
              <p><small>{new Date(analysis.created_at).toLocaleString()}</small></p>
            </li>
          ))}
        </ul>
      ) : (
        <p>История анализов пуста.</p>
      )}
    </div>
  );
}
