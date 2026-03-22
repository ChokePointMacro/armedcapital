'use client';

import { Layout } from '@/components/Layout';
import { AgentDetail } from '@/components/AgentDetail';
import { useUser } from '@clerk/nextjs';
import { useParams } from 'next/navigation';

export default function AgentDetailPage() {
  const { user } = useUser();
  const params = useParams();
  const agentId = params.id as string;

  const userData = user ? {
    id: user.id,
    username: user.username || user.primaryEmailAddress?.emailAddress || '',
    displayName: user.fullName || user.firstName || '',
    profileImage: user.imageUrl || '',
    authMethod: 'clerk' as const,
  } : null;

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <AgentDetail agentId={agentId} />
    </Layout>
  );
}
