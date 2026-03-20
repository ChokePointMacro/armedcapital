'use client';

import { Layout } from '@/components/Layout';
import { Profile } from '@/components/Profile';
import { useUser } from '@clerk/nextjs';

export default function ProfilePage() {
  const { user } = useUser();

  const userData = user ? {
    id: user.id,
    username: user.username || user.primaryEmailAddress?.emailAddress || '',
    displayName: user.fullName || user.firstName || '',
    profileImage: user.imageUrl || '',
    authMethod: 'clerk' as const,
  } : null;

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Profile user={userData} onLogout={() => {}} />
    </Layout>
  );
}
