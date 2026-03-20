'use client';

import { Layout } from '@/components/Layout';
import { Schedule } from '@/components/Schedule';
import { useUser } from '@clerk/nextjs';

export default function SchedulePage() {
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
      <Schedule  />
    </Layout>
  );
}
