'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function OperationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Operations] Page error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full border border-red-500/20 rounded-lg bg-red-950/10 p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-4" />
        <h2 className="text-base font-mono text-gray-200 mb-2">
          Operations Error
        </h2>
        <p className="text-[11px] font-mono text-gray-500 mb-6 leading-relaxed">
          Something went wrong loading this section.
          {error?.message && (
            <span className="block mt-2 text-red-400/60 break-words">
              {error.message}
            </span>
          )}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded border border-btc-orange/30 bg-btc-orange/5 text-btc-orange text-[10px] font-mono uppercase tracking-wider hover:bg-btc-orange/10 transition-colors"
          >
            <RefreshCw size={12} />
            Try Again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded border border-gray-700 bg-gray-900/60 text-gray-400 text-[10px] font-mono uppercase tracking-wider hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={12} />
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
