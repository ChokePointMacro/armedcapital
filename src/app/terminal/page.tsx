'use client';

import { Layout } from '@/components/Layout';
import { Terminal } from '@/components/Terminal';
import { useUserData } from '@/hooks/useUserData';

export default function TerminalPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Terminal  />
    </Layout>
  );
}
