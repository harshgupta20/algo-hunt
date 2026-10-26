'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import mark from '@/client/assets/logo-mark.png';
import { LANDING_HELP } from './help';
import s from './landing.module.css';

const LINKS = [
  ['Build', '#build'],
  ['Connect', '#connect'],
  ['Alerts', '#alerts'],
  ['Paper', '#paper'],
  ['Backtest', '#backtest'],
  ['Equity', '#equity'],
  ['Market', '#market'],
  ['AI', '#ai'],
] as const;

const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function IstClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(IST.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Tooltip content={LANDING_HELP.clock} side="bottom">
      <span tabIndex={0} className={clsx(s.mono, 'hidden items-center gap-2 text-xs text-slate-400 outline-none sm:inline-flex')}>
        <span className="text-slate-600">IST</span>
        <span className="tabular-nums text-slate-200">{now ?? '--:--:--'}</span>
      </span>
    </Tooltip>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header
      className={clsx(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled ? 'border-b border-white/[0.06] bg-[#05070d]/75 backdrop-blur-xl' : 'border-b border-transparent',
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-3">
          <Image src={mark} alt="Algo Hunt" height={26} width={Math.round((26 * mark.width) / mark.height)} priority />
          <span className={clsx(s.display, 'text-[15px] tracking-[0.02em] text-fg')}>ALGO HUNT</span>
        </a>
        <div className="hidden items-center gap-1 lg:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="rounded-lg px-3 py-1.5 text-[13px] text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-fg">
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <IstClock />
          <Tooltip content={LANDING_HELP.openApp} side="bottom">
            <Link
              href="/login"
              className="group inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#05070d] transition-transform hover:scale-[1.03]"
            >
              Sign in
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Tooltip>
        </div>
      </nav>
    </header>
  );
}
