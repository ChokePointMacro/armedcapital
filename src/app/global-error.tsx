'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui', padding: '60px 24px', textAlign: 'center' }}>
        <h1 style={{ color: '#f7931a', fontSize: '24px', marginBottom: '12px' }}>Something went wrong</h1>
        <p style={{ color: '#888', marginBottom: '24px' }}>An unexpected error occurred. Our team has been notified.</p>
        <button
          onClick={reset}
          style={{
            background: '#f7931a',
            color: '#0a0a0a',
            border: 'none',
            padding: '10px 24px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Try Again
        </button>
      </body>
    </html>
  );
}
