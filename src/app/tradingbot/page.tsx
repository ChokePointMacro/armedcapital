'use client';

import { Layout } from '@/components/Layout';
import { TradingBot } from '@/components/TradingBot';
import { useUserData } from '@/hooks/useUserData';

export default function TradingBotPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <TradingBot user={userData} />
    </Layout>
  );
}
