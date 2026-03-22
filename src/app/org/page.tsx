'use client';

import { Layout } from '@/components/Layout';
import { OrgChart } from '@/components/OrgChart';
import { useUser } from '@clerk/nextjs';

export default function OrgPage() {
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
      <OrgChart user={userData} />
    </Layout>
  );
}
