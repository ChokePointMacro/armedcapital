'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface JobStatus {
  status: 'idle' | 'generating' | 'uploading' | 'complete' | 'error';
  message: string;
  videoUrl?: string;
  progress?: number;
}

interface HistoryEntry {
  id: string;
  niche: string;
  language: string;
  status: 'complete' | 'error';
  message: string;
  videoUrl?: string;
  timestamp: Date;
}

export function YouTubeShorts() {
  const [niche, setNiche] = useState('');
  const [language, setLanguage] = useState('en');
  const [chromeProfile, setChromeProfile] = useState('Default');
  const [autoUpload, setAutoUpload] = useState(false);
  const [health, setHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [healthDetail, setHealthDetail] = useState<{ llm_provider?: string; active_model?: string }>({});
  const [job, setJob] = useState<JobStatus>({ status: 'idle', message: '' });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [scriptData, setScriptData] = useState<{
    title?: string; description?: string; hook?: string;
    script?: string; tags?: string; cta?: string; raw?: string;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Health check on mount
  useEffect(() => {
    checkHealth();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/studio/health');
      if (res.ok) {
        const data = await res.json();
        setHealth('ok');
        setHealthDetail(data);
      } else {
        setHealth('error');
        setHealthDetail({});
      }
    } catch {
      setHealth('error');
      setHealthDetail({});
    }
  }, []);

  // Poll for generation status while running
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/studio/youtube');
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'complete' || data.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
          if (data.message) {
            setJob((prev) => ({ ...prev, message: data.message, progress: data.progress }));
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
  }, []);

  const generate = useCallback(async () => {
    if (!niche.trim()) return;
    setJob({ status: 'generating', message: 'Starting YouTube Shorts pipeline...' });
    startPolling();
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
      if (pollRef.current) clearInterval(pollRef.current);
      if (res.ok && data.success !== false) {
        setScriptData({
          title: data.title,
          description: data.description,
          hook: data.hook,
          script: data.script,
          tags: data.tags,
          cta: data.cta,
          raw: data.raw,
        });
        const entry: HistoryEntry = {
          id: Date.now().toString(),
          niche,
          language,
          status: 'complete',
          message: data.message || 'Script generated successfully',
          videoUrl: data.videoUrl || data.video_path,
          timestamp: new Date(),
        };
        setJob({ status: 'complete', message: entry.message, videoUrl: entry.videoUrl });
        setHistory((prev) => [entry, ...prev].slice(0, 10));
      } else {
        const entry: HistoryEntry = {
          id: Date.now().toString(),
          niche,
          language,
          status: 'error',
          message: data.error || data.detail || 'Generation failed',
          timestamp: new Date(),
        };
        setJob({ status: 'error', message: entry.message });
        setHistory((prev) => [entry, ...prev].slice(0, 10));
      }
    } catch (err: any) {
      if (pollRef.current) clearInterval(pollRef.current);
      setJob({ status: 'error', message: err.message || 'Network error' });
    }
  }, [niche, language, chromeProfile, autoUpload, startPolling]);

  const uploadLast = useCallback(async () => {
    setJob((prev) => ({ ...prev, status: 'uploading', message: 'Uploading to YouTube...' }));
    try {
      const res = await fetch('/api/studio/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload' }),
      });
      const data = await res.json();
      if (res.ok) {
        setJob({ status: 'complete', message: data.message || 'Uploaded!', videoUrl: data.videoUrl });
      } else {
        setJob({ status: 'error', message: data.error || data.detail || 'Upload failed' });
      }
    } catch (err: any) {
      setJob({ status: 'error', message: err.message || 'Network error' });
    }
  }, []);

  const renderVideo = useCallback(async () => {
    if (!scriptData) return;
    setJob((prev) => ({ ...prev, status: 'uploading', message: 'Rendering MP4 video via ffmpeg...' }));
    try {
      const res = await fetch('/api/studio/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'render',
          title: scriptData.title,
          hook: scriptData.hook,
          script: scriptData.script,
          cta: scriptData.cta,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setJob({ status: 'complete', message: `MP4 video rendered! (${data.duration}s)`, videoUrl: data.videoUrl });
      } else {
        setJob({ status: 'error', message: data.error || 'Video render failed' });
      }
    } catch (err: any) {
      setJob({ status: 'error', message: err.message || 'Network error' });
    }
  }, [scriptData]);

  const statusColor = {
    unknown: 'bg-gray-600',
    ok: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <div className="space-y-6">
      {/* Header + Health */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">YouTube Shorts Generator</h2>
          <p className="text-[11px] font-mono text-gray-500 mt-0.5">
            AI-powered short-form video pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          {health === 'ok' && healthDetail.active_model && (
            <span className="text-[10px] font-mono text-gray-600 bg-gray-800 px-2 py-0.5 rounded">
              {healthDetail.llm_provider}: {healthDetail.active_model}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full animate-pulse', statusColor[health])} />
            <button
              onClick={checkHealth}
              className="text-[11px] font-mono text-gray-400 hover:text-btc-orange transition-colors"
            >
              {health === 'unknown' ? 'Check Studio API' : health === 'ok' ? 'Connected' : 'Disconnected — Click to retry'}
            </button>
          </div>
        </div>
      </div>

      {health === 'error' && (
        <div className="rounded border border-yellow-700/50 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400 font-mono">
          Studio Python service is offline. Start it with: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-[11px]">cd studio &amp;&amp; uvicorn studio.api.server:app --port 8100</code>
        </div>
      )}

      {/* Config Form */}
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
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
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
            placeholder="Default"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-btc-orange focus:outline-none"
          />
          <p className="text-[10px] text-gray-600 mt-1">Chrome profile for YouTube authentication</p>
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpload}
              onChange={(e) => setAutoUpload(e.target.checked)}
              className="accent-btc-orange"
            />
            <span className="text-sm text-gray-300">Auto-upload to YouTube after generation</span>
          </label>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={generate}
          disabled={!niche.trim() || job.status === 'generating' || job.status === 'uploading'}
          className={cn(
            'px-6 py-2.5 rounded font-mono text-sm font-semibold transition-colors',
            niche.trim() && job.status !== 'generating' && job.status !== 'uploading'
              ? 'bg-btc-orange text-black hover:bg-btc-orange/90'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          )}
        >
          {job.status === 'generating' ? 'Generating...' : 'Generate Short'}
        </button>

        {job.status === 'complete' && scriptData && (scriptData.title || scriptData.script) && (
          <button
            onClick={renderVideo}
            disabled={job.status === 'uploading'}
            className="px-5 py-2.5 rounded font-mono text-sm font-semibold bg-green-600 text-white hover:bg-green-500 transition-colors"
          >
            {job.status === 'uploading' ? 'Rendering...' : 'Render Video (MP4)'}
          </button>
        )}

        {job.videoUrl && (
          <a
            href={job.videoUrl}
            download
            className="px-5 py-2.5 rounded font-mono text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors inline-flex items-center gap-2"
          >
            Download MP4 ↓
          </a>
        )}

        {job.status !== 'idle' && (
          <button
            onClick={() => setJob({ status: 'idle', message: '' })}
            className="px-4 py-2.5 rounded font-mono text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Status Display */}
      {job.status !== 'idle' && (
        <div
          className={cn(
            'rounded border px-4 py-3 text-sm font-mono',
            job.status === 'complete' && 'border-green-700 bg-green-900/20 text-green-400',
            job.status === 'error' && 'border-red-700 bg-red-900/20 text-red-400',
            (job.status === 'generating' || job.status === 'uploading') &&
              'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
          )}
        >
          <div className="flex items-center gap-2">
            {(job.status === 'generating' || job.status === 'uploading') && (
              <div className="w-3 h-3 border-2 border-btc-orange border-t-transparent rounded-full animate-spin" />
            )}
            <span>{job.message}</span>
          </div>
          {job.videoUrl && (
            <p className="mt-2 text-[11px] text-gray-400">
              Video: <span className="text-green-400">{job.videoUrl}</span>
            </p>
          )}
        </div>
      )}

      {/* Video Player */}
      {job.videoUrl && (
        <div className="rounded border border-gray-700 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Rendered Video</h3>
            <a
              href={job.videoUrl}
              download
              className="text-[10px] font-mono text-btc-orange hover:text-btc-orange/80 transition-colors"
            >
              Download MP4 ↓
            </a>
          </div>
          <div className="flex justify-center">
            <video
              src={job.videoUrl}
              controls
              className="rounded border border-gray-700"
              style={{ width: '270px', height: '480px', backgroundColor: '#0a0a0a' }}
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-2 text-center">
            Real MP4 video — download or right-click to save
          </p>
        </div>
      )}

      {/* Generated Script Display */}
      {scriptData && (scriptData.title || scriptData.script) && (
        <div className="rounded border border-gray-700 bg-gray-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Generated Script</h3>
            <button
              onClick={() => {
                const text = [
                  scriptData.title && `TITLE: ${scriptData.title}`,
                  scriptData.description && `DESCRIPTION: ${scriptData.description}`,
                  scriptData.hook && `HOOK: ${scriptData.hook}`,
                  scriptData.script && `SCRIPT: ${scriptData.script}`,
                  scriptData.tags && `TAGS: ${scriptData.tags}`,
                  scriptData.cta && `CTA: ${scriptData.cta}`,
                ].filter(Boolean).join('\n\n');
                navigator.clipboard.writeText(text);
              }}
              className="text-[10px] font-mono text-btc-orange hover:text-btc-orange/80 transition-colors"
            >
              Copy All
            </button>
          </div>

          {scriptData.title && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Title</p>
              <p className="text-sm text-white">{scriptData.title}</p>
            </div>
          )}
          {scriptData.hook && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Hook (first 3 sec)</p>
              <p className="text-sm text-btc-orange font-medium">{scriptData.hook}</p>
            </div>
          )}
          {scriptData.script && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Script</p>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{scriptData.script}</p>
            </div>
          )}
          {scriptData.description && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Description</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">{scriptData.description}</p>
            </div>
          )}
          {scriptData.tags && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {scriptData.tags.split(',').map((tag, i) => (
                  <span key={i} className="text-[10px] font-mono bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}
          {scriptData.cta && (
            <div>
              <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-0.5">Call to Action</p>
              <p className="text-sm text-green-400">{scriptData.cta}</p>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <h3 className="text-[11px] font-mono text-gray-500 uppercase tracking-wider mb-2">Recent Generations</h3>
          <div className="space-y-1.5">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between text-[11px] font-mono px-3 py-2 rounded bg-gray-900/50 border border-gray-800"
              >
                <div className="flex items-center gap-2">
                  <div className={cn('w-1.5 h-1.5 rounded-full', h.status === 'complete' ? 'bg-green-500' : 'bg-red-500')} />
                  <span className="text-gray-300">{h.niche}</span>
                  <span className="text-gray-600">({h.language})</span>
                </div>
                <span className="text-gray-600">
                  {h.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
