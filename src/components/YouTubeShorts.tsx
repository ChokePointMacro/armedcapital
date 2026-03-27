'use client';

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface JobStatus {
  status: 'idle' | 'generating' | 'uploading' | 'complete' | 'error';
  message: string;
  videoUrl?: string;
}

export function YouTubeShorts() {
  const [niche, setNiche] = useState('');
  const [language, setLanguage] = useState('en');
  const [chromeProfile, setChromeProfile] = useState('Default');
  const [autoUpload, setAutoUpload] = useState(false);
  const [health, setHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [job, setJob] = useState<JobStatus>({ status: 'idle', message: '' });

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/studio/health');
      if (res.ok) {
        setHealth('ok');
      } else {
        setHealth('error');
      }
    } catch {
      setHealth('error');
    }
  }, []);

  const generate = useCallback(async () => {
    if (!niche.trim()) return;
    setJob({ status: 'generating', message: 'Starting YouTube Shorts generation...' });
    try {
      const res = await fetch('/api/studio/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          niche,
          language,
          chromeProfile,
          autoUpload,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setJob({ status: 'complete', message: data.message || 'Video generated!', videoUrl: data.videoUrl });
      } else {
        setJob({ status: 'error', message: data.error || 'Generation failed' });
      }
    } catch (err: any) {
      setJob({ status: 'error', message: err.message || 'Network error' });
    }
  }, [niche, language, chromeProfile, autoUpload]);

  const statusColor = {
    unknown: 'bg-gray-600',
    ok: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">YouTube Shorts Generator</h2>
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', statusColor[health])} />
          <button
            onClick={checkHealth}
            className="text-[11px] font-mono text-gray-400 hover:text-btc-orange transition-colors"
          >
            {health === 'unknown' ? 'Check Studio API' : health === 'ok' ? 'Connected' : 'Disconnected'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Niche / Topic</label>
          <input
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. crypto, fitness, cooking"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-btc-orange focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-btc-orange focus:outline-none"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Chrome Profile</label>
          <input
            type="text"
            value={chromeProfile}
            onChange={(e) => setChromeProfile(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-btc-orange focus:outline-none"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpload}
              onChange={(e) => setAutoUpload(e.target.checked)}
              className="accent-btc-orange"
            />
            <span className="text-sm text-gray-300">Auto-upload to YouTube</span>
          </label>
        </div>
      </div>

      <button
        onClick={generate}
        disabled={!niche.trim() || job.status === 'generating'}
        className={cn(
          'px-6 py-2.5 rounded font-mono text-sm font-semibold transition-colors',
          niche.trim() && job.status !== 'generating'
            ? 'bg-btc-orange text-black hover:bg-btc-orange/90'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        )}
      >
        {job.status === 'generating' ? 'Generating...' : 'Generate Short'}
      </button>

      {job.status !== 'idle' && (
        <div
          className={cn(
            'rounded border px-4 py-3 text-sm font-mono',
            job.status === 'complete' && 'border-green-700 bg-green-900/20 text-green-400',
            job.status === 'error' && 'border-red-700 bg-red-900/20 text-red-400',
            job.status === 'generating' && 'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
          )}
        >
          {job.message}
        </div>
      )}
    </div>
  );
}