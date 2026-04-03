'use client';

import { Layout } from '@/components/Layout';
import { Settings } from '@/components/Settings';
import { useUserData } from '@/hooks/useUserData';

export default function SettingsPage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Settings user={userData} onLogout={() => {}} />
    </Layout>
  );
}
