'use client';

import { Layout } from '@/components/Layout';
import { Traffic } from '@/components/Traffic';
import { useUserData } from '@/hooks/useUserData';

export default function TrafficPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Traffic />
    </Layout>
  );
}
