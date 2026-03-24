'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * OAuth 2.0 callback page for X/Twitter.
 * Twitter redirects here after user authorizes the app.
 * This page:
 *   1. Extracts the authorization code + state from the URL
 *   2. Sends them to our API to exchange for tokens
 *   3. Posts a message back to the opener (Settings page) with the result
 *   4. Closes itself
 */
export default function XCallbackPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your X account...');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      setStatus('error');
      setMessage(`Authorization denied: ${error}`);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Missing authorization code — try connecting again from Settings.');
      return;
    }

    // Exchange code for tokens via our API
    fetch('/api/auth/x/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.success) {
          setStatus('success');
          setMessage(`Connected as ${data.handle || 'your X account'}`);

          // Notify the opener (Settings page popup listener)
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH_X_CONNECT_SUCCESS',
              handle: data.handle,
              username: data.username,
            }, '*');
          }

          // Auto-close after a short delay
          setTimeout(() => window.close(), 1500);
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to connect — try again.');
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(`Network error: ${err.message}`);
      });
  }, [params]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#000',
      color: '#fff',
      fontFamily: 'monospace',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
        {status === 'loading' && (
          <div style={{ fontSize: 14, color: '#f7931a', marginBottom: 12 }}>
            ⟳ Connecting...
          </div>
        )}
        {status === 'success' && (
          <div style={{ fontSize: 14, color: '#10b981', marginBottom: 12 }}>
            ✓ Connected
          </div>
        )}
        {status === 'error' && (
          <div style={{ fontSize: 14, color: '#ef4444', marginBottom: 12 }}>
            ✗ Error
          </div>
        )}
        <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>{message}</p>
        {status === 'error' && (
          <button
            onClick={() => window.close()}
            style={{
              marginTop: 16,
              padding: '8px 24px',
              background: 'transparent',
              border: '1px solid #333',
              color: '#999',
              fontFamily: 'monospace',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
