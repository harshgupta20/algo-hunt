/** Log files in the app's data folder (logs/), kept small: over 5 MB the file is moved to .1 and a new one started. */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX = 5 * 1024 * 1024;

export function logFile(dir: string, name: string): (text: string) => void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  return (text: string) => {
    try {
      if (existsSync(file) && statSync(file).size > MAX) renameSync(file, `${file}.1`);
      appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
    } catch {
      /* a log that can't be written is not worth stopping for */
    }
  };
}
