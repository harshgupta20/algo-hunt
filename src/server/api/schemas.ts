/**
 * Zod schemas for request validation. Kept next to the API so controllers can
 * parse-and-throw with a single call.
 */
import { z } from 'zod';
import { HttpError } from './http';

export const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light']),
  soundEnabled: z.boolean(),
  soundRepeat: z.boolean().optional(),
  browserNotifications: z.boolean(),
});

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg);
  }
  return result.data;
}
