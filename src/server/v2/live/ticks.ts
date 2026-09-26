/**
 * Kite Connect WebSocket (KiteTicker) binary protocol → ticks.
 *
 * A message is [int16 packet count] then, per packet, [int16 length][packet].
 * Packets are big-endian int32 fields; prices are in paise (÷100; CDS ÷1e7,
 * BCD ÷1e4). Lengths: 8 = LTP · 28/32 = index quote/full · 44 = quote ·
 * 184 = full (quote + last trade time, OI, exchange time, depth).
 * A 1-byte message is Kite's heartbeat (no ticks).
 */

export interface Tick {
  token: number;
  /** Last traded price (index value for indices). */
  price: number;
  /** Cumulative volume traded today (tradables in quote / full mode). */
  volume?: number;
  /** Open interest (full mode, derivatives). */
  oi?: number;
  /** Epoch ms of the last trade (full mode, tradables). */
  tradeTime?: number;
  /** Epoch ms of the exchange's snapshot (full mode). */
  exchangeTime?: number;
  /** Today's open (quote / full mode). */
  dayOpen?: number;
  /** Index packets carry no trades or volume. */
  index: boolean;
}

const SEGMENT_INDICES = 9;
const SEGMENT_NSE_CD = 3;
const SEGMENT_BSE_CD = 6;

function divisor(token: number): number {
  const segment = token & 0xff;
  if (segment === SEGMENT_NSE_CD) return 10_000_000;
  if (segment === SEGMENT_BSE_CD) return 10_000;
  return 100;
}

/** Parse one binary WebSocket message. Unknown packet sizes are skipped. */
export function parseTicks(buf: ArrayBuffer): Tick[] {
  if (buf.byteLength < 4) return []; // heartbeat
  const view = new DataView(buf);
  const count = view.getUint16(0);
  const out: Tick[] = [];
  let at = 2;
  for (let n = 0; n < count && at + 2 <= buf.byteLength; n++) {
    const len = view.getUint16(at);
    const p = at + 2;
    at = p + len;
    if (at > buf.byteLength || len < 8) break;
    const i32 = (o: number) => view.getInt32(p + o);
    const u32 = (o: number) => view.getUint32(p + o);
    const token = u32(0);
    const div = divisor(token);
    const price = i32(4) / div;
    const index = (token & 0xff) === SEGMENT_INDICES;
    if (len === 8) {
      out.push({ token, price, index });
      continue;
    }
    if (index) {
      // 28: token, ltp, high, low, open, close, change · 32: + exchange timestamp
      const tick: Tick = { token, price, index, dayOpen: i32(16) / div };
      if (len >= 32) {
        const ts = u32(28);
        if (ts) tick.exchangeTime = ts * 1000;
      }
      out.push(tick);
      continue;
    }
    if (len < 44) continue;
    // 44: token, ltp, last qty, avg price, volume, buy qty, sell qty, open, high, low, close
    const tick: Tick = { token, price, index, volume: u32(16), dayOpen: i32(28) / div };
    if (len >= 64) {
      const ltt = u32(44);
      if (ltt) tick.tradeTime = ltt * 1000;
      tick.oi = u32(48);
      const ts = u32(60);
      if (ts) tick.exchangeTime = ts * 1000;
    }
    out.push(tick);
  }
  return out;
}

/** Build a binary message from packets (tests and the local replay tool). */
export function encodePackets(packets: ArrayBuffer[]): ArrayBuffer {
  const total = 2 + packets.reduce((n, p) => n + 2 + p.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, packets.length);
  let at = 2;
  for (const p of packets) {
    view.setUint16(at, p.byteLength);
    out.set(new Uint8Array(p), at + 2);
    at += 2 + p.byteLength;
  }
  return out.buffer;
}

/** A full-mode (184-byte) packet for a tradable instrument. */
export function fullPacket(t: { token: number; price: number; volume: number; tradeTime: number; exchangeTime: number; oi?: number; dayOpen?: number }): ArrayBuffer {
  const buf = new ArrayBuffer(184);
  const v = new DataView(buf);
  const div = divisor(t.token);
  v.setUint32(0, t.token);
  v.setInt32(4, Math.round(t.price * div));
  v.setUint32(16, t.volume);
  v.setInt32(28, Math.round((t.dayOpen ?? t.price) * div));
  v.setUint32(44, Math.floor(t.tradeTime / 1000));
  v.setUint32(48, t.oi ?? 0);
  v.setUint32(60, Math.floor(t.exchangeTime / 1000));
  return buf;
}

/** A full-mode (32-byte) index packet. */
export function indexPacket(t: { token: number; price: number; exchangeTime: number; dayOpen?: number }): ArrayBuffer {
  const buf = new ArrayBuffer(32);
  const v = new DataView(buf);
  v.setUint32(0, t.token);
  v.setInt32(4, Math.round(t.price * 100));
  v.setInt32(16, Math.round((t.dayOpen ?? t.price) * 100));
  v.setUint32(28, Math.floor(t.exchangeTime / 1000));
  return buf;
}
