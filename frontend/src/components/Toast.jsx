import React, { useEffect } from 'react';

export default function Toast({ message, type = 'success', onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <div className={`app-toast app-toast--${type}`} role="status" aria-live="polite">
      <span className="app-toast-icon">{type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <div>
        <p>{message}</p>
      </div>
    </div>
  );
}
