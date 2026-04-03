// API fetch wrapper for Next.js
// In Next.js, API routes are same-origin, so we just need relative URLs
export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const headers: Record<string, string> = {
    ...(options.headers as any),
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...options, headers, credentials: 'include' });
};
