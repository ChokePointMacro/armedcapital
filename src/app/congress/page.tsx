'use client';

import { Layout } from '@/components/Layout';
import { CongressTrading } from '@/components/CongressTrading';
import { useUserData } from '@/hooks/useUserData';

export default function CongressPage() {
  const userData = useUserData();
  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <CongressTrading />
    </Layout>
  );
}
