'use client';

import { useUser } from '@clerk/nextjs';
import type { UserData } from '@/types';

/**
 * Shared hook that converts Clerk's user object into our UserData type.
 * Replaces the identical 7-line boilerplate that was copy-pasted across 21+ pages.
 */
export function useUserData(): UserData | null {
  const { user } = useUser();

  if (!user) return null;

  const email = user.primaryEmailAddress?.emailAddress || '';
  const username = user.username || email;

  // Hardcoded admin — sole owner
  const ADMIN_EMAILS = ['michael.nield7@gmail.com'];
  const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

  return {
    id: user.id,
    username,
    displayName: user.fullName || user.firstName || '',
    profileImage: user.imageUrl || '',
    authMethod: 'clerk' as const,
    isAdmin,
  };
}
