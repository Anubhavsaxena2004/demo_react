import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function App() {
  const [message, setMessage] = useState('Connecting to the backend…');
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/hello`)
      .then((response) => {
        if (!response.ok) throw new Error('The server returned an error.');
        return response.json();
      })
      .then((data) => setMessage(data.message))
      .catch(() => {
        setMessage('Could not reach the backend. Start the server and try again.');
        setError(true);
      });
  }, []);

  return (
    <main className="page">
      <section className="card">
        <span className="eyebrow">A simple full-stack demo</span>
        <h1>Hello, React.</h1>
        <p className="intro">A small frontend and backend, kept in separate folders.</p>
        <div className={`api-message${error ? ' error' : ''}`}>
          <span className="status-dot" />
          <p>{message}</p>
        </div>
        <footer>
          <span>Frontend <code>localhost:5173</code></span>
          <span>Backend <code>localhost:3001</code></span>
        </footer>
      </section>
    </main>
  );
}
