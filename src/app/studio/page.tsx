'use client';

import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Compose } from '@/components/Compose';
import { Schedule } from '@/components/Schedule';
import { Reports } from '@/components/Reports';
import { YouTubeShorts } from '@/components/YouTubeShorts';
import { TwitterBotStudio } from '@/components/TwitterBotStudio';
import { useUserData } from '@/hooks/useUserData';
import { PenLine, Clock, FileText, Youtube, Twitter } from 'lucide-react';

const SUB_TABS = [
  { key: 'compose', label: 'Compose', icon: <PenLine size={12} /> },
  { key: 'schedule', label: 'Schedule', icon: <Clock size={12} /> },
  { key: 'reports', label: 'Reports', icon: <FileText size={12} /> },
  { key: 'youtube', label: 'YouTube Shorts', icon: <Youtube size={12} /> },
  { key: 'xbot', label: 'X Bot', icon: <Twitter size={12} /> },
] as const;

type SubTab = typeof SUB_TABS[number]['key'];

export default function StudioPage() {
  const userData = useUserData();
  const [tab, setTab] = useState<SubTab>('compose');

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-px">
        {SUB_TABS.map(st => (
          <button
            key={st.key}
            onClick={() => setTab(st.key)}
            className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors ${
              tab === st.key
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {st.icon} {st.label}
          </button>
        ))}
      </div>

      {tab === 'compose' && <Compose user={userData} />}
      {tab === 'schedule' && <Schedule />}
      {tab === 'reports' && <Reports />}
      {tab === 'youtube' && <YouTubeShorts />}
      {tab === 'xbot' && <TwitterBotStudio />}
    </Layout>
  );
}
