'use client';

import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import { useUserData } from '@/hooks/useUserData';

export default function ProfilePage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Profile user={userData} onLogout={() => {}} />
    </Layout>
  );
}
