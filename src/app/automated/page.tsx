'use client';

import { Layout } from '@/components/Layout';
import { AutomatedReports } from '@/components/AutomatedReports';
import { useUserData } from '@/hooks/useUserData';

export default function AutomatedReportsPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <AutomatedReports  />
    </Layout>
  );
}
