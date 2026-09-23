/**
 * Underlying groups — a reusable named set of underlyings (e.g. "Indices" =
 * NIFTY + BANKNIFTY + …). Applying a strategy to a group creates one monitor
 * per member (each fires its own alert), so the same condition is applied
 * across all members without configuring each one by hand.
 */
export interface UnderlyingGroup {
  id: string;
  name: string;
  members: string[];
  /** True for the seeded read-only preset (e.g. Indices). */
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnderlyingGroupInput {
  name: string;
  members: string[];
}
