'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

export const BackButton = () => {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-2 mb-6 text-[10px] font-mono uppercase tracking-widest text-btc-orange/50 hover:text-btc-orange transition-colors group"
    >
      <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
      Back
    </button>
  );
};
