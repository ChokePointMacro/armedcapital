'use client';

import React, { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface TweetStatus {
  status: 'idle' | 'previewing' | 'posting' | 'posted' | 'error';
  message: string;
  tweetUrl?: string;
}

export function TwitterBotStudio() {
  const [topic, setTopic] = useState('');
  const [customText, setCustomText] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [chromeProfile, setChromeProfile] = useState('Default');
  const [preview, setPreview] = useState('');
  const [tweet, setTweet] = useState<TweetStatus>({ status: 'idle', message: '' });

  const generatePreview = useCallback(async () => {
    if (!topic.trim() && !useCustom) return;
    setTweet({ status: 'previewing', message: 'Generating tweet preview...' });
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
        setPreview(data.preview || data.text || '');
        setTweet({ status: 'idle', message: '' });
      } else {
        setTweet({ status: 'error', message: data.error || 'Preview failed' });
      }
    } catch (err: any) {
      setTweet({ status: 'error', message: err.message || 'Network error' });
    }
  }, [topic, customText, useCustom]);

  const postTweet = useCallback(async () => {
    const text = useCustom ? customText : preview;
    if (!text.trim()) return;
    setTweet({ status: 'posting', message: 'Posting tweet...' });
    try {
      const res = await fetch('/api/studio/twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post',
          text,
          chromeProfile,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTweet({ status: 'posted', message: data.message || 'Tweet posted!', tweetUrl: data.tweetUrl });
      } else {
        setTweet({ status: 'error', message: data.error || 'Post failed' });
      }
    } catch (err: any) {
      setTweet({ status: 'error', message: err.message || 'Network error' });
    }
  }, [preview, customText, useCustom, chromeProfile]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">X Bot (Twitter)</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Topic / Theme</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Bitcoin price action, macro outlook"
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
            <span className="text-sm text-gray-300">Use custom text instead</span>
          </label>
          {useCustom && (
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Write your tweet..."
              rows={3}
              maxLength={280}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-btc-orange focus:outline-none resize-none"
            />
          )}
        </div>

        <div className="w-1/2">
          <label className="block text-[11px] font-mono text-gray-400 mb-1">Chrome Profile</label>
          <input
            type="text"
            value={chromeProfile}
            onChange={(e) => setChromeProfile(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-btc-orange focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={generatePreview}
          disabled={(!topic.trim() && !useCustom) || tweet.status === 'previewing'}
          className={cn(
            'px-5 py-2.5 rounded font-mono text-sm font-semibold transition-colors',
            (topic.trim() || useCustom) && tweet.status !== 'previewing'
              ? 'bg-gray-700 text-white hover:bg-gray-600'
              : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          )}
        >
          {tweet.status === 'previewing' ? 'Generating...' : 'Preview'}
        </button>
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
          {tweet.status === 'posting' ? 'Posting...' : 'Post Tweet'}
        </button>
      </div>

      {preview && !useCustom && (
        <div className="rounded border border-gray-700 bg-gray-900/50 px-4 py-3">
          <p className="text-[11px] font-mono text-gray-500 mb-1">AI-Generated Preview:</p>
          <p className="text-sm text-white">{preview}</p>
          <p className="text-[10px] text-gray-600 mt-1">{preview.length}/280</p>
        </div>
      )}

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
          {tweet.message}
          {tweet.tweetUrl && (
            <a href={tweet.tweetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 underline">
              View
            </a>
          )}
        </div>
      )}
    </div>
  );
}