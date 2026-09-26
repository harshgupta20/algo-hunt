import Image from 'next/image';
import clsx from 'clsx';
import mark from '../assets/logo-mark.png';

/**
 * The Algo Hunt mark + wordmark. `onBrand` sits on the gradient header: the full-colour
 * mark on a white tile (it would blend into the blue otherwise) with a white wordmark.
 */
export function Logo({ height = 38, onBrand = false }: { height?: number; onBrand?: boolean }) {
  const img = <Image src={mark} alt="Algo Hunt logo" height={height} width={Math.round((height * mark.width) / mark.height)} priority />;
  return (
    <div className="flex items-center gap-2.5">
      {onBrand ? <span className="flex items-center rounded-xl bg-white px-1.5 py-1 shadow-sm ring-1 ring-white/60">{img}</span> : img}
      <div>
        <div className={clsx('text-[15px] font-bold leading-tight', onBrand ? 'text-white' : 'brand-text')}>Algo Hunt</div>
        <div className={clsx('text-[10px] uppercase tracking-widest', onBrand ? 'text-white/75' : 'text-slate-500')}>Alert Platform</div>
      </div>
    </div>
  );
}
