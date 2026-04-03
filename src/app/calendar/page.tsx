'use client';

import { Layout } from '@/components/Layout';
import { EconomicCalendar } from '@/components/EconomicCalendar';
import { useUserData } from '@/hooks/useUserData';

export default function CalendarPage() {
  const userData = useUserData();
  return (
    <Layout user={userData} onLogout={() => {}} onLogin={() => {}}>
      <EconomicCalendar />
    </Layout>
  );
}
