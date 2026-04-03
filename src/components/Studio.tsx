"use client";

import React, { useState, useEffect, useCallback } from "react";

/**
 * Studio Tab — YouTube Shorts + Twitter/X Bot dashboard
 * Sits alongside Markets, Agents, TradingBot in the ArmedCapital UI.
 */

// ── Types ─────────────────────────────────────────────────────────────

interface StudioHealth {
  status: string;
  llm_provider: string;
  active_model: string | null;
}

interface YouTubeStatus {
  status: string;
  step: string;
  niche: string | null;
  subject: string | null;
  has_script: boolean;
  image_count: number;
  has_tts: boolean;
  has_video: boolean;
  uploaded_url: string | null;
  errors: string[];
}

interface TwitterStatus {
  status: string;
  topic: string;
  language: string;
  last_post: string | null;
  post_count: number;
  errors: string[];
}

// ── API helpers ───────────────────────────────────────────────────────

const api = async (path: string, opts?: RequestInit) => {
  const res = await fetch(`/api/studio${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
};

// ── Components ────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    ok: "bg-green-500",
    working: "bg-yellow-500",
    complete: "bg-green-500",
    failed: "bg-red-500",
    idle: "bg-gray-500",
    offline: "bg-red-700",
    generating: "bg-blue-500",
    posting: "bg-yellow-500",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-mono text-white ${colors[status] || "bg-gray-600"}`}
    >
      {status}
    </span>
  );
};

const ErrorList = ({ errors }: { errors: string[] }) => {
  if (!errors.length) return null;
  return (
    <div className="mt-2 p-2 bg-red-900/30 border border-red-700 rounded text-sm">
      {errors.map((e, i) => (
        <div key={i} className="text-red-300">
          {e}
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────

export default function Studio() {
  const [health, setHealth] = useState<StudioHealth | null>(null);
  const [activeTab, setActiveTab] = useState<"youtube" | "twitter">("youtube");

  // YouTube state
  const [ytNiche, setYtNiche] = useState("AI Technology");
  const [ytLanguage, setYtLanguage] = useState("English");
  const [ytChromeDir, setYtChromeDir] = useState("");
  const [ytChromeProfile, setYtChromeProfile] = useState("Default");
  const [ytUpload, setYtUpload] = useState(false);
  const [ytStatus, setYtStatus] = useState<YouTubeStatus | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytResult, setYtResult] = useState<any>(null);

  // Twitter state
  const [twTopic, setTwTopic] = useState("Finance and Markets");
  const [twLanguage, setTwLanguage] = useState("English");
  const [twChromeDir, setTwChromeDir] = useState("");
  const [twChromeProfile, setTwChromeProfile] = useState("Default");
  const [twCustomText, setTwCustomText] = useState("");
  const [twPreview, setTwPreview] = useState<string | null>(null);
  const [twLoading, setTwLoading] = useState(false);
  const [twResult, setTwResult] = useState<any>(null);

  // ── Health check ────────────────────────────────────────────────

  const checkHealth = useCallback(async () => {
    try {
      const data = await api("/health");
      setHealth(data);
    } catch {
      setHealth({ status: "offline", llm_provider: "unknown", active_model: null });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // ── YouTube handlers ────────────────────────────────────────────

  const handleYouTubeGenerate = async () => {
    setYtLoading(true);
    setYtResult(null);
    try {
      const result = await api("/youtube", {
        method: "POST",
        body: JSON.stringify({
          niche: ytNiche,
          language: ytLanguage,
          chrome_profile_dir: ytChromeDir,
          chrome_profile_name: ytChromeProfile,
          upload: ytUpload,
        }),
      });
      setYtResult(result);
    } catch (e: any) {
      setYtResult({ success: false, errors: [e.message] });
    }
    setYtLoading(false);
  };

  const pollYouTubeStatus = async () => {
    const data = await api("/youtube");
    setYtStatus(data);
  };

  useEffect(() => {
    if (ytLoading) {
      const interval = setInterval(pollYouTubeStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [ytLoading]);

  // ── Twitter handlers ────────────────────────────────────────────

  const handleTwitterPreview = async () => {
    setTwLoading(true);
    setTwPreview(null);
    try {
      const result = await api("/twitter", {
        method: "POST",
        body: JSON.stringify({
          topic: twTopic,
          language: twLanguage,
          chrome_profile_dir: twChromeDir,
          chrome_profile_name: twChromeProfile,
          preview_only: true,
        }),
      });
      setTwPreview(result.text || null);
    } catch (e: any) {
      setTwResult({ success: false, errors: [e.message] });
    }
    setTwLoading(false);
  };

  const handleTwitterPost = async () => {
    setTwLoading(true);
    setTwResult(null);
    try {
      const result = await api("/twitter", {
        method: "POST",
        body: JSON.stringify({
          topic: twTopic,
          language: twLanguage,
          chrome_profile_dir: twChromeDir,
          chrome_profile_name: twChromeProfile,
          custom_text: twCustomText || twPreview || undefined,
        }),
      });
      setTwResult(result);
    } catch (e: any) {
      setTwResult({ success: false, errors: [e.message] });
    }
    setTwLoading(false);
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Studio</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">Service:</span>
          <StatusBadge status={health?.status || "offline"} />
          {health?.active_model && (
            <span className="text-xs text-gray-500 font-mono">{health.active_model}</span>
          )}
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
        {(["youtube", "twitter"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {tab === "youtube" ? "YouTube Shorts" : "Twitter / X Bot"}
          </button>
        ))}
      </div>

      {/* YouTube Shorts Panel */}
      {activeTab === "youtube" && (
        <div className="bg-gray-800/50 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Generate YouTube Short</h2>
          <p className="text-sm text-gray-400">
            AI generates a topic, script, images, voiceover, and combines into a ready-to-upload MP4.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Niche / Topic</label>
              <input
                type="text"
                value={ytNiche}
                onChange={(e) => setYtNiche(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder="AI Technology, Crypto, Fitness..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Language</label>
              <input
                type="text"
                value={ytLanguage}
                onChange={(e) => setYtLanguage(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Chrome Profile Directory</label>
              <input
                type="text"
                value={ytChromeDir}
                onChange={(e) => setYtChromeDir(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                placeholder="~/Library/Application Support/Google/Chrome"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Profile Name</label>
              <input
                type="text"
                value={ytChromeProfile}
                onChange={(e) => setYtChromeProfile(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                placeholder="Default"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={ytUpload}
              onChange={(e) => setYtUpload(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            Auto-upload to YouTube after generation
          </label>

          <button
            onClick={handleYouTubeGenerate}
            disabled={ytLoading || !ytNiche}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded-lg text-white font-medium transition-colors"
          >
            {ytLoading ? "Generating..." : "Generate YouTube Short"}
          </button>

          {/* Status while generating */}
          {ytLoading && ytStatus && (
            <div className="bg-gray-900/50 rounded p-3 space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge status={ytStatus.status} />
                <span className="text-sm text-gray-300">Step: {ytStatus.step}</span>
              </div>
              {ytStatus.subject && (
                <p className="text-xs text-gray-400">Topic: {ytStatus.subject}</p>
              )}
              <p className="text-xs text-gray-500">
                Images: {ytStatus.image_count} | Script: {ytStatus.has_script ? "yes" : "no"} | TTS:{" "}
                {ytStatus.has_tts ? "yes" : "no"}
              </p>
              <ErrorList errors={ytStatus.errors} />
            </div>
          )}

          {/* Result */}
          {ytResult && (
            <div
              className={`rounded p-3 ${
                ytResult.success ? "bg-green-900/30 border border-green-700" : "bg-red-900/30 border border-red-700"
              }`}
            >
              <p className="text-sm text-white font-medium">
                {ytResult.success ? "Video generated!" : "Generation failed"}
              </p>
              {ytResult.video_path && (
                <p className="text-xs text-gray-400 font-mono mt-1">{ytResult.video_path}</p>
              )}
              {ytResult.upload?.url && (
                <a
                  href={ytResult.upload.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:underline mt-1 block"
                >
                  View on YouTube
                </a>
              )}
              <ErrorList errors={ytResult.errors || []} />
            </div>
          )}
        </div>
      )}

      {/* Twitter / X Panel */}
      {activeTab === "twitter" && (
        <div className="bg-gray-800/50 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Twitter / X Bot</h2>
          <p className="text-sm text-gray-400">
            Generate AI-powered tweets and post them to X.com via Selenium.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Topic</label>
              <input
                type="text"
                value={twTopic}
                onChange={(e) => setTwTopic(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                placeholder="Finance, Tech, Markets..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Language</label>
              <input
                type="text"
                value={twLanguage}
                onChange={(e) => setTwLanguage(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Chrome Profile Directory</label>
              <input
                type="text"
                value={twChromeDir}
                onChange={(e) => setTwChromeDir(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                placeholder="~/Library/Application Support/Google/Chrome"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Profile Name</label>
              <input
                type="text"
                value={twChromeProfile}
                onChange={(e) => setTwChromeProfile(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                placeholder="Default"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Custom Text (optional)</label>
            <textarea
              value={twCustomText}
              onChange={(e) => setTwCustomText(e.target.value)}
              rows={3}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              placeholder="Leave empty to auto-generate, or type your own tweet..."
            />
            <p className="text-xs text-gray-500 mt-1">{twCustomText.length}/260 characters</p>
          </div>

          {/* Preview */}
          {twPreview && (
            <div className="bg-gray-900/50 rounded p-3 border border-gray-700">
              <p className="text-xs text-gray-500 mb-1">Preview:</p>
              <p className="text-sm text-white">{twPreview}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleTwitterPreview}
              disabled={twLoading || !twTopic}
              className="flex-1 py-2.5 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 rounded-lg text-white font-medium transition-colors"
            >
              {twLoading ? "Generating..." : "Preview Tweet"}
            </button>
            <button
              onClick={handleTwitterPost}
              disabled={twLoading || !twTopic || !twChromeDir}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg text-white font-medium transition-colors"
            >
              {twLoading ? "Posting..." : "Post to X"}
            </button>
          </div>

          {/* Result */}
          {twResult && (
            <div
              className={`rounded p-3 ${
                twResult.success ? "bg-green-900/30 border border-green-700" : "bg-red-900/30 border border-red-700"
              }`}
            >
              <p className="text-sm text-white font-medium">
                {twResult.success ? "Posted!" : "Posting failed"}
              </p>
              {twResult.content && (
                <p className="text-xs text-gray-300 mt-1">{twResult.content}</p>
              )}
              <ErrorList errors={twResult.errors || []} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
