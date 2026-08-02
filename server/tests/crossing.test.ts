import { describe, expect, it } from 'vitest';
import { alreadyAbove, alreadyBelow, crossAbove, crossBelow } from '../src/services/strategy/crossing.js';

describe('crossAbove', () => {
  it('detects the exact spec example 59.99 -> 60.01', () => {
    expect(crossAbove(59.99, 60.01, 60)).toBe(true);
  });

  it('detects a 0.01 crossing 59.99 -> 60.00', () => {
    expect(crossAbove(59.99, 60.0, 60)).toBe(true);
  });

  it('does not fire when already above (60.00 -> 60.01)', () => {
    expect(crossAbove(60.0, 60.01, 60)).toBe(false);
  });

  it('does not fire when both below', () => {
    expect(crossAbove(58, 59.5, 60)).toBe(false);
  });

  it('does not fire on the first reading (prev undefined)', () => {
    expect(crossAbove(undefined, 61, 60)).toBe(false);
  });
});

describe('crossBelow', () => {
  it('detects the exact spec example 40.01 -> 39.99', () => {
    expect(crossBelow(40.01, 39.99, 40)).toBe(true);
  });

  it('detects a 0.01 crossing 40.01 -> 40.00', () => {
    expect(crossBelow(40.01, 40.0, 40)).toBe(true);
  });

  it('does not fire when already below', () => {
    expect(crossBelow(39.5, 39.0, 40)).toBe(false);
  });

  it('does not fire on the first reading (prev undefined)', () => {
    expect(crossBelow(undefined, 39, 40)).toBe(false);
  });
});

describe('alreadyAbove', () => {
  it('is true when prev and curr are both at/above the level', () => {
    expect(alreadyAbove(65, 67, 60)).toBe(true);
    expect(alreadyAbove(60, 60, 60)).toBe(true);
  });

  it('is false when it was a fresh crossing (prev below)', () => {
    expect(alreadyAbove(59.99, 60.01, 60)).toBe(false);
  });

  it('is mutually exclusive with crossAbove', () => {
    const cases: Array<[number, number]> = [
      [59.99, 60.01],
      [60, 60.01],
      [58, 62],
      [61, 62],
    ];
    for (const [prev, curr] of cases) {
      expect(crossAbove(prev, curr, 60) && alreadyAbove(prev, curr, 60)).toBe(false);
    }
  });
});

describe('alreadyBelow', () => {
  it('is true when prev and curr are both at/below the level', () => {
    expect(alreadyBelow(35, 30, 40)).toBe(true);
    expect(alreadyBelow(40, 40, 40)).toBe(true);
  });
});
