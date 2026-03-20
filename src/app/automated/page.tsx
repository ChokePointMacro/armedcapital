'use client';

import { Layout } from '@/components/Layout';
import { AutomatedReports } from '@/components/AutomatedReports';
import { useUser } from '@clerk/nextjs';

export default function AutomatedReportsPage() {
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
      <AutomatedReports  />
    </Layout>
  );
}
