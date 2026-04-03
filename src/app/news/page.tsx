'use client';

import { Layout } from '@/components/Layout';
import { NewsFeed } from '@/components/NewsFeed';
import { useUserData } from '@/hooks/useUserData';

export default function NewsPage() {
  const userData = useUserData();
  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <NewsFeed />
    </Layout>
  );
}
