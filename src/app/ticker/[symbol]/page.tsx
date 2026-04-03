'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Layout } from '@/components/Layout';
import { TickerExplorer } from '@/components/TickerExplorer';
import { useUserData } from '@/hooks/useUserData';

export default function TickerPage() {
  const params = useParams();
  const symbol = (params.symbol as string)?.toUpperCase();
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <TickerExplorer symbol={symbol} />
    </Layout>
  );
}
