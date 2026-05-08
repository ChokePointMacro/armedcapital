'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect, useRef, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

let posthogInitialized = false;

/**
 * Initializes PostHog on the client and wires:
 *   - Manual pageview capture (because capture_pageview is false)
 *   - Clerk identify on sign-in / reset on sign-out
 *
 * Gated on NEXT_PUBLIC_POSTHOG_KEY: no-ops cleanly when not configured.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY && !posthogInitialized) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        // We capture manually below so we can ride pathname changes from the
        // App Router (capture_pageview only fires on full page load).
        capture_pageview: false,
        // Capture pageleave automatically — gives us session duration without
        // requiring opt-in beacons.
        capture_pageleave: true,
      });
      posthogInitialized = true;
    }
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}

/**
 * Captures a $pageview event on every App Router navigation.
 * Pulled out so useSearchParams can be wrapped in <Suspense>, per Next.js
 * 14 requirements (else the whole tree opts out of static rendering).
 */
function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/**
 * Mirrors Clerk auth state into PostHog's person identity:
 *   - identify(userId, traits) when a Clerk user is loaded
 *   - reset() when the user signs out (so we don't leak identity to next user)
 */
function PostHogIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const lastIdentifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || !isLoaded) return;

    if (isSignedIn && user) {
      if (lastIdentifiedRef.current !== user.id) {
        posthog.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          username: user.username || undefined,
        });
        lastIdentifiedRef.current = user.id;
      }
    } else if (lastIdentifiedRef.current) {
      posthog.reset();
      lastIdentifiedRef.current = null;
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}
