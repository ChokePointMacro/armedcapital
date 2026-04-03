'use client';

import { Layout } from '@/components/Layout';
import { FlowAlerts } from '@/components/FlowAlerts';
import { useUserData } from '@/hooks/useUserData';

export default function SignalsPage() {
  const userData = useUserData();
  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <FlowAlerts />
    </Layout>
  );
}
