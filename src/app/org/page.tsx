'use client';

import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { OrgChart } from '@/components/OrgChart';
import { DailyOps } from '@/components/DailyOps';
import { useUserData } from '@/hooks/useUserData';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'org', label: 'Org Chart' },
  { id: 'ops', label: 'Daily Ops' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function OrgPage() {
  const userData = useUserData();
  const [activeTab, setActiveTab] = useState<TabId>('ops');

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-5 py-2.5 text-sm font-mono transition-colors border-b-2',
              activeTab === tab.id
                ? 'border-btc-orange text-btc-orange font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'org' && <OrgChart user={userData} />}
      {activeTab === 'ops' && <DailyOps />}
    </Layout>
  );
}
