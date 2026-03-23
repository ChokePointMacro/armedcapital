'use client';

import { Layout } from '@/components/Layout';
import { Scanner } from '@/components/Scanner';
import { useUserData } from '@/hooks/useUserData';

export default function ScannerPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Scanner user={userData} />
    </Layout>
  );
}
