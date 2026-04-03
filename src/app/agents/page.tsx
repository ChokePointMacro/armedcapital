'use client';

import { Layout } from '@/components/Layout';
import { Agents } from '@/components/Agents';
import { useUserData } from '@/hooks/useUserData';

export default function AgentsPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Agents user={userData} />
    </Layout>
  );
}
