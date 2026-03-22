'use client';

import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Usage } from '@/components/Usage';
import { Billing } from '@/components/Billing';
import { AuditLog } from '@/components/AuditLog';
import { useUser } from '@clerk/nextjs';
import { BarChart3, DollarSign, FileText } from 'lucide-react';

const SUB_TABS = [
  { key: 'usage', label: 'Usage', icon: <BarChart3 size={12} /> },
  { key: 'billing', label: 'Billing', icon: <DollarSign size={12} /> },
  { key: 'audit', label: 'Audit', icon: <FileText size={12} /> },
] as const;

type SubTab = typeof SUB_TABS[number]['key'];

export default function OperationsPage() {
  const { user } = useUser();
  const [tab, setTab] = useState<SubTab>('usage');

  const userData = user ? {
    id: user.id,
    username: user.username || user.primaryEmailAddress?.emailAddress || '',
    displayName: user.fullName || user.firstName || '',
    profileImage: user.imageUrl || '',
    authMethod: 'clerk' as const,
  } : null;

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      {/* Sub-tab navigation */}
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

      {tab === 'usage' && <Usage user={userData} />}
      {tab === 'billing' && <Billing />}
      {tab === 'audit' && <AuditLog />}
    </Layout>
  );
}
