'use client';

import { Layout } from '@/components/Layout';
import { Dashboard } from '@/components/Dashboard';
import { useUserData } from '@/hooks/useUserData';

export default function HomePage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Dashboard />
    </Layout>
  );
}
