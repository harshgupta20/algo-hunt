'use client';

/**
 * The AI's answers: a small Markdown subset rendered as React elements (never raw HTML) — headings, bullet and
 * numbered lists, tables, **bold**, _italic_, `code`, and paragraphs.
 */
import { Fragment, type ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])_[^_]+_(?![\w])|(?<![\w*])\*[^*\s][^*]*\*(?![\w*]))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold text-slate-100">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[11px]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${n++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={key} className="mt-1 font-semibold text-slate-100">{inline(h[2]!, key)}</p>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key} className="border-ink-700" />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                {head.map((c, k) => (
                  <th key={k} className="px-2 py-1 font-medium">{inline(c, `${key}h${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/50">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, k) => (
                    <td key={k} className="px-2 py-1 tabular-nums text-slate-300">{inline(c, `${key}r${ri}c${k}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && bullet.test(lines[i]!)) {
        const indent = /^\s{2,}/.test(lines[i]!);
        items.push(
          <li key={i} className={indent ? 'ml-4' : undefined}>
            {inline(lines[i]!.replace(bullet, ''), `${key}i${i}`)}
          </li>,
        );
        i++;
      }
      blocks.push(ordered ? <ol key={key} className="ml-4 list-decimal space-y-0.5">{items}</ol> : <ul key={key} className="ml-4 list-disc space-y-0.5">{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4})\s/.test(lines[i]!) && !bullet.test(lines[i]!) && !/^\s*\|.*\|\s*$/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(
      <p key={key}>
        {para.map((p, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {inline(p, `${key}p${k}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="flex flex-col gap-2 text-xs leading-relaxed text-slate-300">{blocks}</div>;
}
