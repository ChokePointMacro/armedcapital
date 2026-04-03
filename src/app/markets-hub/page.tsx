'use client';

import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Markets } from '@/components/Markets';
import { MarketTide } from '@/components/MarketTide';
import { TradeFlow } from '@/components/TradeFlow';
import { OptionsFlow } from '@/components/OptionsFlow';
import { DarkPool } from '@/components/DarkPool';
import { useUserData } from '@/hooks/useUserData';
import { TrendingUp, Activity, Waves } from 'lucide-react';

const SUB_TABS: { key: string; label: string; icon: React.ReactNode; badge?: string }[] = [
  { key: 'markets', label: 'Markets', icon: <TrendingUp size={12} /> },
  { key: 'market-tide', label: 'Market Tide', icon: <Activity size={12} /> },
  { key: 'trade-flow', label: 'Crypto Flow', icon: <Waves size={12} /> },
  { key: 'options-flow', label: 'Options Flow', icon: <Waves size={12} />, badge: 'LIVE' },
  { key: 'dark-pool', label: 'Dark Pool', icon: <Waves size={12} />, badge: 'NEW' },
];

type SubTab = 'markets' | 'market-tide' | 'trade-flow' | 'options-flow' | 'dark-pool';

export default function MarketsHubPage() {
  const userData = useUserData();
  const [tab, setTab] = useState<SubTab>('markets');

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      {/* Sub-tab navigation */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-px flex-wrap">
        {SUB_TABS.map(st => (
          <button
            key={st.key}
            onClick={() => setTab(st.key)}
            className={`flex items-center gap-1.5 text-[11px] font-mono px-4 py-2.5 border-b-2 transition-colors relative ${
              tab === st.key
                ? 'border-btc-orange text-btc-orange'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {st.icon} {st.label}
            {st.badge && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                st.badge === 'NEW'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-btc-orange/20 text-btc-orange'
              }`}>
                {st.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'markets' && <Markets user={userData} />}
      {tab === 'market-tide' && <MarketTide />}
      {tab === 'trade-flow' && <TradeFlow />}
      {tab === 'options-flow' && <OptionsFlow />}
      {tab === 'dark-pool' && <DarkPool />}
    </Layout>
  );
}
