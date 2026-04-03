'use client';

import React from 'react';
import { Layout } from '@/components/Layout';
import { Compose } from '@/components/Compose';
import { useUserData } from '@/hooks/useUserData';

export default function ComposePage() {
  const userData = useUserData();

  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <Compose user={userData} />
    </Layout>
  );
}
