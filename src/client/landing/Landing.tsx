import clsx from 'clsx';
import { AiWords } from './AiWords';
import { AlertFlow } from './AlertFlow';
import { BacktestRewind } from './BacktestRewind';
import { BuildCircuit } from './BuildCircuit';
import { Closing, Principles } from './Closing';
import { ConnectRadar } from './ConnectRadar';
import { EquityPyramid } from './EquityPyramid';
import { Hero } from './Hero';
import { MarketGlance } from './MarketGlance';
import { Nav } from './Nav';
import { PaperDesk } from './PaperDesk';
import { TickerTape } from './TickerTape';
import s from './landing.module.css';

/** The product landing page (the home page, /). Always the dark theme, whatever the app is set to. */
export function Landing() {
  return (
    <div data-theme="dark" className={clsx(s.root, 'text-slate-300')}>
      <Nav />
      <main>
        <Hero />
        <TickerTape />
        <BuildCircuit />
        <ConnectRadar />
        <AlertFlow />
        <PaperDesk />
        <BacktestRewind />
        <EquityPyramid />
        <MarketGlance />
        <AiWords />
        <Principles />
      </main>
      <Closing />
    </div>
  );
}
