'use client';

import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, BadgeCheck, DatabaseZap, Laptop, ShieldCheck } from 'lucide-react';
import { Tooltip } from '@/client/components/Tooltip';
import mark from '@/client/assets/logo-mark.png';
import { LANDING_HELP } from './help';
import { Reveal, Section } from './kit';
import s from './landing.module.css';

const PROMISES = [
  { icon: ShieldCheck, title: 'Alerts, not orders', body: 'It hunts and tells you. You place the trade in Kite.' },
  { icon: BadgeCheck, title: 'Verified on Kite', body: 'Every alert is checked on Kite’s own candle first.' },
  { icon: DatabaseZap, title: 'Never waits', body: 'Alerts fire from memory; records are saved right after.' },
  { icon: Laptop, title: 'Runs on your machine', body: 'A Windows app that updates itself, or one double-click.' },
];

export function Principles() {
  return (
    <Section id="trust" className="overflow-hidden">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-14">
        <Reveal>
          <div
            className={clsx(
              s.display,
              'select-none text-[clamp(11rem,30vw,22rem)] leading-[0.8] text-transparent [-webkit-text-stroke:2px_rgb(var(--accent))]',
            )}
            aria-hidden
          >
            0
          </div>
        </Reveal>
        <Reveal delay={100}>
          <h2 className={clsx(s.display, 'text-[clamp(2.4rem,5.4vw,4.4rem)] text-fg')}>
            orders placed.
            <br />
            <span className="text-accent">Ever.</span>
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-slate-400">Algo Hunt watches the market for you. Every decision to trade stays yours.</p>
        </Reveal>
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROMISES.map(({ icon: Icon, title, body }, i) => (
          <Reveal key={title} className={clsx(s.panel, 'p-6')} delay={i * 70}>
            <Icon className="h-6 w-6 text-accent-soft" strokeWidth={1.6} />
            <div className="mt-4 text-[17px] font-semibold text-fg">{title}</div>
            <div className="mt-1.5 text-[14px] leading-relaxed text-slate-400">{body}</div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function Closing() {
  return (
    <>
      <section className="relative overflow-hidden px-4 py-32 sm:px-6 sm:py-44">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={clsx(s.halo, 'absolute rounded-full border border-accent/30')}
              style={{ width: i * 240, height: i * 240, animationDuration: '5s', animationDelay: `${i * 0.9}s` }}
            />
          ))}
          <span className="absolute h-[520px] w-[520px] rounded-full bg-accent/15 blur-[120px]" />
        </div>
        <Reveal className="relative mx-auto max-w-4xl text-center">
          <h2 className={clsx(s.display, 'text-[clamp(3rem,10vw,8.5rem)] text-fg')}>
            Start the <span className={s.alertText}>hunt.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-slate-400">Your strategies, every market, alerts you can trust.</p>
          <div className="mt-10 flex justify-center">
            <Tooltip content={LANDING_HELP.openApp}>
              <Link
                href="/login"
                className="group inline-flex items-center gap-2.5 rounded-full bg-accent px-8 py-4 text-[17px] font-semibold text-white shadow-[0_16px_60px_-10px_rgb(var(--accent))] transition-transform hover:scale-[1.04]"
              >
                Open Algo Hunt
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </Tooltip>
          </div>
        </Reveal>
      </section>
      <footer className="border-t border-white/[0.06] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src={mark} alt="Algo Hunt" height={22} width={Math.round((22 * mark.width) / mark.height)} />
            <span className={clsx(s.display, 'text-sm text-fg')}>ALGO HUNT</span>
          </div>
          <p className="max-w-xl text-[12px] leading-relaxed text-slate-500">
            Alerts and research for Indian markets. Algo Hunt never places orders, and nothing here is investment advice. Examples on this page use sample data.
          </p>
        </div>
      </footer>
    </>
  );
}
