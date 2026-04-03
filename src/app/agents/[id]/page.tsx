'use client';

import { Layout } from '@/components/Layout';
import { AgentDetail } from '@/components/AgentDetail';
import { useUserData } from '@/hooks/useUserData';
import { useParams } from 'next/navigation';

export default function AgentDetailPage() {
  const userData = useUserData();
  const params = useParams();
  const agentId = params.id as string;

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <AgentDetail agentId={agentId} />
    </Layout>
  );
}
