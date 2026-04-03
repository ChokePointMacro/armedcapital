'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X, Search } from 'lucide-react';
import { SignInButton, useClerk } from '@clerk/nextjs';
import { CPMLogo } from './CPMLogo';
import { Dropdown } from './Dropdown';
import { NotificationBell } from './NotificationBell';
import MatrixBackground from './MatrixBackground';
import type { UserData } from '@/types';

const NAV_ITEMS = [
  { to: '/', label: 'Briefing' },
  { to: '/markets-hub', label: 'Markets' },
  { to: '/signals', label: 'Signals' },
  { to: '/news', label: 'News' },
  { to: '/congress', label: 'Congress' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/automated', label: 'Automated' },
  { to: '/terminal', label: 'Terminal' },
  { to: '/agents', label: 'Agents', admin: true },
  { to: '/tradingbot', label: 'TradingBot', admin: true },
  { to: '/org', label: 'Org' },
  { to: '/traffic', label: 'Traffic', admin: true },
  { to: '/operations', label: 'Operations', admin: true },
];

const AUTH_NAV_ITEMS = [
  { to: '/studio', label: 'Studio' },
];

function NavLink({ to, label, active, onClick, admin }: { to: string; label: string; active: boolean; onClick?: () => void; admin?: boolean }) {
  return (
    <Link
      href={to}
      onClick={onClick}
      className={`text-[10px] font-mono uppercase tracking-widest transition-colors ${
        active
          ? 'text-btc-orange'
          : 'text-gray-400 hover:text-btc-orange'
      }`}
    >
      {label}
      {active && <span className="block h-[1px] bg-btc-orange mt-0.5 shadow-[0_0_4px_#f7931a]" />}
    </Link>
  );
}

export const Layout = ({ children, user, onLogout, onLogin }: {
  children: React.ReactNode;
  user: UserData | null;
  onLogout?: () => void;
  onLogin?: (u: UserData) => void;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useClerk();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchInput.trim()) {
      router.push(`/ticker/${searchInput.toUpperCase()}`);
      setSearchInput('');
    }
  };

  // Check if user is an admin
  const isUserAdmin = user && (user.isAdmin || user.username === process.env.NEXT_PUBLIC_ADMIN_EMAIL);

  // Traffic beacon — tracks page views and device info
  useEffect(() => {
    const beacon = async () => {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
      try {
        await fetch('/api/admin/traffic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page: pathname,
            screenRes: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : null,
            userId: user?.id || null,
            userName: user?.displayName || user?.username || null,
            userEmail: user?.username || null,
          }),
        });
      } catch { /* non-critical */ }
    };
    beacon();
  }, [pathname, user]);

  const handleLogout = () => {
    signOut({ redirectUrl: '/' });
    onLogout?.();
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  const filteredNavItems = NAV_ITEMS.filter(item => {
    if (item.admin && !isUserAdmin) return false;
    return true;
  });

  const allNavItems = [...filteredNavItems, ...(user ? AUTH_NAV_ITEMS : [])];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans selection:bg-btc-orange selection:text-black relative overflow-x-hidden">
      <MatrixBackground />

      <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-btc-orange/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => router.push('/')} className="flex items-center gap-2.5 group cursor-pointer">
            <CPMLogo size={34} className="group-hover:opacity-80 transition-opacity" />
            <div className="flex flex-col items-start leading-none">
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-white">ChokePoint</span>
              <span className="text-[11px] font-mono font-bold tracking-[0.25em] uppercase text-btc-orange" style={{ textShadow: '0 0 8px rgba(247,147,26,0.6)' }}>Macro</span>
            </div>
          </button>

          <div className="flex items-center gap-4 sm:gap-6">
            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-5 border-r border-btc-orange/20 pr-5">
              {allNavItems.map(item => (
                <NavLink key={item.to} to={item.to} label={item.label} active={isActive(item.to)} admin={item.admin} />
              ))}
            </nav>

            {/* Ticker Search */}
            <div className="hidden sm:flex items-center h-8 px-3 bg-black/40 border border-btc-orange/30 rounded transition-colors hover:border-btc-orange/60 focus-within:border-btc-orange focus-within:shadow-[0_0_8px_rgba(247,147,26,0.3)]">
              <input
                type="text"
                placeholder="TICKER"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                onKeyDown={handleSearch}
                className="bg-transparent text-xs font-mono text-gray-300 placeholder-gray-600 outline-none w-24"
              />
              <Search size={14} className="text-gray-500 ml-1" />
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-gray-400 hover:text-btc-orange transition-colors p-1"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {user && <NotificationBell />}

            {user ? (
              <Dropdown user={user} onLogout={handleLogout} />
            ) : (
              <SignInButton mode="redirect">
                <button
                  className="flex items-center gap-2 px-4 py-2 bg-btc-orange text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-90 transition-opacity shadow-[0_0_10px_rgba(247,147,26,0.3)]"
                >
                  Sign In
                </button>
              </SignInButton>
            )}
          </div>
        </div>

        {/* Mobile nav dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden overflow-hidden border-t border-btc-orange/10 bg-[#0a0a0a]/98 backdrop-blur-md"
            >
              <div className="px-4 py-4 space-y-3">
                {/* Mobile ticker search */}
                <div className="flex items-center h-8 px-3 bg-black/40 border border-btc-orange/30 rounded transition-colors hover:border-btc-orange/60 focus-within:border-btc-orange">
                  <input
                    type="text"
                    placeholder="TICKER"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                    onKeyDown={handleSearch}
                    className="bg-transparent text-xs font-mono text-gray-300 placeholder-gray-600 outline-none w-full"
                  />
                  <Search size={14} className="text-gray-500 ml-1" />
                </div>

                {/* Mobile nav links */}
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {allNavItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      active={isActive(item.to)}
                      onClick={() => setMobileMenuOpen(false)}
                      admin={item.admin}
                    />
                  ))}
                </div>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {children}
      </main>

      <footer className="border-t border-btc-orange/10 py-12 mt-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <CPMLogo size={28} />
            <div>
              <p className="text-xs font-mono font-bold tracking-[0.2em] uppercase text-white">ChokePoint Macro</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-btc-orange/50">Intelligence Brief Platform</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-btc-orange rounded-full animate-pulse shadow-[0_0_5px_#f7931a]" />
              <span className="text-[10px] font-mono text-btc-orange/70">Live Feed Active</span>
            </div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-30">&copy; 2026 ChokePoint Macro</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
