'use client';

import { Layout } from '@/components/Layout';
import { Chokepoints } from '@/components/Chokepoints';
import { useUserData } from '@/hooks/useUserData';

export default function ChokepointsPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Chokepoints />
    </Layout>
  );
}
