'use client';

import { Layout } from '@/components/Layout';
import { OrgChart } from '@/components/OrgChart';
import { useUserData } from '@/hooks/useUserData';

export default function OrgPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <OrgChart user={userData} />
    </Layout>
  );
}
