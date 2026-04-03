'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface TweetStatus {
  status: 'idle' | 'previewing' | 'posting' | 'posted' | 'error';
  message: string;
  tweetUrl?: string;
}

interface TweetHistory {
  id: string;
  text: string;
  status: 'posted' | 'error';
  tweetUrl?: string;
  timestamp: Date;
}

export function TwitterBotStudio() {
  const [topic, setTopic] = useState('');
  const [customText, setCustomText] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [chromeProfile, setChromeProfile] = useState('Default');
  const [preview, setPreview] = useState('');
  const [tweet, setTweet] = useState<TweetStatus>({ status: 'idle', message: '' });
  const [history, setHistory] = useState<TweetHistory[]>([]);
  const [health, setHealth] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [charCount, setCharCount] = useState(0);

  // Health check on mount
  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/studio/health');
      setHealth(res.ok ? 'ok' : 'error');
    } catch {
      setHealth('error');
    }
  }, []);

  // Update char count
  useEffect(() => {
    const text = useCustom ? customText : preview;
    setCharCount(text.length);
  }, [useCustom, customText, preview]);

  const generatePreview = useCallback(async () => {
    if (!topic.trim() && !useCustom) return;
    setTweet({ status: 'previewing', message: 'Generating AI tweet...' });
    try {
      const res = await fetch('/api/studio/twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          topic,
          customText: useCustom ? customText : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data.text || data.preview || '');
        setTweet({ status: 'idle', message: '' });
      } else {
        setTweet({ status: 'error', message: data.error || data.detail || 'Preview failed' });
      }
    } catch (err: any) {
      setTweet({ status: 'error', message: err.message || 'Network error' });
    }
  }, [topic, customText, useCustom]);

  const postTweet = useCallback(async () => {
    const text = useCustom ? customText : preview;
    if (!text.trim()) return;
    setTweet({ status: 'posting', message: 'Posting to X...' });
    try {
      const res = await fetch('/api/studio/twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post',
          topic,
          text,
          chromeProfile,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        // Open X intent URL to let user post with one click
        if (data.intentUrl || data.tweetUrl) {
          window.open(data.intentUrl || data.tweetUrl, '_blank');
        }
        const entry: TweetHistory = {
          id: Date.now().toString(),
          text,
          status: 'posted',
          tweetUrl: data.intentUrl || data.tweetUrl || data.tweet_url,
          timestamp: new Date(),
        };
        setTweet({
          status: 'posted',
          message: data.message || 'Tweet ready — opened X to post!',
          tweetUrl: entry.tweetUrl,
        });
        setHistory((prev) => [entry, ...prev].slice(0, 20));
        // Clear inputs after success
        setPreview('');
        if (!useCustom) setTopic('');
      } else {
        const entry: TweetHistory = {
          id: Date.now().toString(),
          text,
          status: 'error',
          timestamp: new Date(),
        };
        setTweet({ status: 'error', message: data.error || data.detail || 'Post failed' });
        setHistory((prev) => [entry, ...prev].slice(0, 20));
      }
    } catch (err: any) {
      setTweet({ status: 'error', message: err.message || 'Network error' });
    }
  }, [preview, customText, useCustom, chromeProfile, topic]);

  const statusColor = {
    unknown: 'bg-gray-600',
    ok: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">X Bot (Twitter)</h2>
          <p className="text-[11px] font-mono text-gray-500 mt-0.5">
            AI-powered tweets — generate previews or post directly
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full animate-pulse', statusColor[health])} />
          <button
            onClick={checkHealth}
            className="text-[11px] font-mono text-gray-400 hover:text-btc-orange transition-colors"
          >
            {health === 'unknown' ? 'Check API' : health === 'ok' ? 'Connected' : 'Disconnected'}
          </button>
        </div>
      </div>

      {health === 'error' && (
        <div className="rounded border border-yellow-700/50 bg-yellow-900/10 px-4 py-3 text-sm text-yellow-400 font-mono">
          Studio Python service is offline. Start it with: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-[11px]">cd studio &amp;&amp; uvicorn studio.api.server:app --port 8100</code>
        </div>
      )}

      {/* Topic + Custom Text */}
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Topic / Theme</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Bitcoin price action, macro outlook, DeFi yields"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-btc-orange focus:outline-none"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
              className="accent-btc-orange"
            />
            <span className="text-sm text-gray-300">Write custom tweet instead of AI-generated</span>
          </label>
          {useCustom && (
            <div>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Write your tweet..."
                rows={3}
                maxLength={280}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-btc-orange focus:outline-none resize-none"
              />
              <div className="flex justify-end mt-1">
                <span className={cn('text-[10px] font-mono', charCount > 260 ? 'text-red-400' : 'text-gray-600')}>
                  {charCount}/280
                </span>
              </div>
            </div>
          )}
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
            <p className="text-[10px] text-gray-600 mt-1">Chrome profile where X is logged in</p>
          </div>
        </div>
      </div>

      {/* AI Preview */}
      {preview && !useCustom && (
        <div className="rounded border border-gray-700 bg-gray-900/50 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-mono text-gray-500">AI-Generated Preview</p>
            <button
              onClick={() => {
                setCustomText(preview);
                setUseCustom(true);
              }}
              className="text-[10px] font-mono text-btc-orange hover:text-btc-orange/80 transition-colors"
            >
              Edit as Custom
            </button>
          </div>
          <p className="text-sm text-white leading-relaxed">{preview}</p>
          <p className={cn('text-[10px] font-mono mt-2', preview.length > 260 ? 'text-red-400' : 'text-gray-600')}>
            {preview.length}/280
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {!useCustom && (
          <button
            onClick={generatePreview}
            disabled={!topic.trim() || tweet.status === 'previewing'}
            className={cn(
              'px-5 py-2.5 rounded font-mono text-sm font-semibold transition-colors',
              topic.trim() && tweet.status !== 'previewing'
                ? 'bg-gray-700 text-white hover:bg-gray-600'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            )}
          >
            {tweet.status === 'previewing' ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </span>
            ) : (
              'Generate Preview'
            )}
          </button>
        )}
        <button
          onClick={postTweet}
          disabled={!(useCustom ? customText.trim() : preview.trim()) || tweet.status === 'posting'}
          className={cn(
            'px-5 py-2.5 rounded font-mono text-sm font-semibold transition-colors',
            (useCustom ? customText.trim() : preview.trim()) && tweet.status !== 'posting'
              ? 'bg-btc-orange text-black hover:bg-btc-orange/90'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          )}
        >
          {tweet.status === 'posting' ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Posting...
            </span>
          ) : (
            'Post to X'
          )}
        </button>

        {tweet.status !== 'idle' && (
          <button
            onClick={() => setTweet({ status: 'idle', message: '' })}
            className="px-4 py-2.5 rounded font-mono text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Status Display */}
      {tweet.status !== 'idle' && tweet.message && (
        <div
          className={cn(
            'rounded border px-4 py-3 text-sm font-mono',
            tweet.status === 'posted' && 'border-green-700 bg-green-900/20 text-green-400',
            tweet.status === 'error' && 'border-red-700 bg-red-900/20 text-red-400',
            (tweet.status === 'previewing' || tweet.status === 'posting') &&
              'border-btc-orange/50 bg-btc-orange/10 text-btc-orange'
          )}
        >
          <span>{tweet.message}</span>
          {tweet.tweetUrl && (
            <a
              href={tweet.tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 underline hover:text-green-300"
            >
              View on X
            </a>
          )}
        </div>
      )}

      {/* Tweet History */}
      {history.length > 0 && (
        <div>
          <h3 className="text-[11px] font-mono text-gray-500 uppercase tracking-wider mb-2">
            Recent Tweets
          </h3>
          <div className="space-y-1.5">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-start justify-between text-[11px] font-mono px-3 py-2 rounded bg-gray-900/50 border border-gray-800"
              >
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div
                    className={cn(
                      'w-1.5 h-1.5 rounded-full mt-1 shrink-0',
                      h.status === 'posted' ? 'bg-green-500' : 'bg-red-500'
                    )}
                  />
                  <span className="text-gray-300 truncate">{h.text}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {h.tweetUrl && (
                    <a
                      href={h.tweetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-btc-orange hover:text-btc-orange/80"
                    >
                      View
                    </a>
                  )}
                  <span className="text-gray-600">
                    {h.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
