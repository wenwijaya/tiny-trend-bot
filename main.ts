// Tiny trend bot — bars-replay/v1, beat buy-and-hold on Solana hourly bars.
//
// Strategy (all deterministic, no clock, no randomness):
//   Per symbol, track a 12h fast EMA and a 26h slow EMA of closes (the
//   classic MACD pair: slow enough to ignore hourly whipsaws, fast enough
//   to catch a multi-day trend within about a day).
//   - ENTER (target weight 14% of equity) when fast EMA > slow EMA and the
//     latest close is at or above the slow EMA: the symbol is in an uptrend.
//   - EXIT (target weight 0) when fast EMA < slow EMA, or the close falls
//     5% below the highest close seen since entry (trailing stop).
//   Rebalance only when the gap between target and current value exceeds
//   2% of equity, so fees (10 bps) and slippage do not eat the edge.
//   Never short, never levered; at most one order per symbol per bar.
//   In a falling market the bot sits in USDC, which is exactly how it
//   beats buy-and-hold; in a rising market it rides the trend.
//
// The harness replays the bot twice and the two action logs must match
// byte for byte, so every decision is a pure function of the bars seen.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const FAST_LEN = 12n;
const SLOW_LEN = 26n;
const TARGET_WEIGHT_BPS = 1200n; // 12% of equity per symbol in an uptrend
const MAX_TOTAL_WEIGHT_BPS = 9000n; // never invest more than 90% of equity
const REBALANCE_BPS = 200n; // 2% of equity dead band
const STOP_BPS = 500n; // 5% trailing stop from the peak close since entry
const BPS = 10000n;
const MAX_SLIPPAGE_BPS = 150;

interface SymState {
  fast: bigint | null;
  slow: bigint | null;
  peak: bigint;
}

const perSymbol = new Map<string, SymState>();

function ema(prev: bigint | null, price: bigint, len: bigint): bigint {
  if (prev === null) return price;
  // EMA = prev + (price - prev) * 2 / (len + 1), integer math, truncating.
  return prev + ((price - prev) * 2n) / (len + 1n);
}

function stateFor(symbol: string): SymState {
  let s = perSymbol.get(symbol);
  if (s === undefined) {
    s = { fast: null, slow: null, peak: 0n };
    perSymbol.set(symbol, s);
  }
  return s;
}

function onBatch(state: BarsState, _batch: Batch): OrderInput[] {
  if (state.warmingUp) return [];
  const orders: OrderInput[] = [];
  const equity = state.equity;
  if (equity <= 0n) return [];

  // First pass: update indicators and decide each symbol's target weight.
  const targets = new Map<string, bigint>();
  let totalTarget = 0n;
  for (const symbol of state.symbols.keys()) {
    const close = state.close(symbol);
    if (close === null) continue;
    const s = stateFor(symbol);
    s.fast = ema(s.fast, close, FAST_LEN);
    s.slow = ema(s.slow, close, SLOW_LEN);
    if (s.fast === null || s.slow === null) continue;
    const held = state.positions.get(symbol);
    if (held !== undefined && held.qty > 0n && close > s.peak) s.peak = close;
    const uptrend = s.fast > s.slow && close >= s.slow;
    const stopped = held !== undefined && held.qty > 0n && s.peak > 0n
      && close * BPS < s.peak * (BPS - STOP_BPS);
    if (uptrend && !stopped) {
      targets.set(symbol, (TARGET_WEIGHT_BPS * equity) / BPS);
      totalTarget += (TARGET_WEIGHT_BPS * equity) / BPS;
    } else {
      targets.set(symbol, 0n);
      if (held === undefined || held.qty === 0n) s.peak = 0n;
    }
  }
  // Scale targets down proportionally if they exceed the total cap.
  const cap = (MAX_TOTAL_WEIGHT_BPS * equity) / BPS;
  const scaleNum = totalTarget > cap ? cap : totalTarget;
  const scaleDen = totalTarget > 0n ? totalTarget : 1n;

  // Second pass: rebalance toward the (scaled) target, one order per symbol.
  for (const [symbol, rawTarget] of targets) {
    const target = (rawTarget * scaleNum) / scaleDen;
    const close = state.close(symbol);
    if (close === null || close <= 0n) continue;
    const meta = state.symbols.get(symbol);
    if (meta === undefined) continue;
    const held = state.positions.get(symbol);
    const heldQty = held === undefined ? 0n : held.qty;
    const current = state.value(symbol, heldQty, close);
    const deadBand = (REBALANCE_BPS * equity) / BPS;
    if (target > current + deadBand) {
      // Buy the gap, capped by the per-symbol weight room and by cash.
      let spend = target - current;
      const room = state.weightRoom(symbol);
      if (spend > room) spend = room;
      if (spend > state.cash) spend = state.cash;
      const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
      if (spend > minNotional) {
        orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
        stateFor(symbol).peak = close;
      }
    } else if (target + deadBand < current) {
      // Sell the excess value, converted back to asset quantity.
      const excess = current - target;
      const qtyScale = 10n ** BigInt(meta.qty_scale);
      const priceScale = 10n ** BigInt(meta.price_scale);
      const quoteScale = 10n ** BigInt(state.hello.capital.quote_scale);
      let qty = (excess * qtyScale * priceScale) / (close * quoteScale);
      if (qty > heldQty) qty = heldQty;
      if (qty > 0n) {
        orders.push({ side: 'sell', symbol, qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        if (target === 0n) stateFor(symbol).peak = 0n;
      }
    }
  }
  return orders;
}

await runBars({ onBatch });
