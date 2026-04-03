import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { PostHogProvider } from '@/components/PostHogProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Armed Capital | Institutional Intelligence Platform',
  description: 'Real-time options flow intelligence, market sentiment analysis, AI-powered trading signals, and institutional-grade advisory tools. Built by ChokePoint Macro.',
  keywords: ['options flow', 'market intelligence', 'trading signals', 'institutional advisory', 'market sentiment'],
  openGraph: {
    title: 'Armed Capital | Institutional Intelligence Platform',
    description: 'Real-time options flow intelligence, AI-powered market analysis, and institutional-grade trading tools.',
    url: 'https://armedcapital.vercel.app',
    siteName: 'Armed Capital',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Armed Capital',
    description: 'Institutional-grade options flow intelligence and AI-powered market analysis.',
  },
  robots: 'index, follow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className="bg-black text-white min-h-screen antialiased">
          <PostHogProvider>
            {children}
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
