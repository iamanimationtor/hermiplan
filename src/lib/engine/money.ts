/**
 * Money arithmetic policy — one place, one rule.
 *
 * The whole product works in **IRR (ریال)** and keeps two decimals internally so
 * that percentage-derived components (overhead 17 %, profit 10 %, contingency
 * 5 %) are not truncated on the way in. The rules below are the contract:
 *
 * 1. **Rounding happens where a value is born, exactly once.** Every component
 *    (`direct`, `overhead`, `profit`, `contingency`, `escalation`) is rounded to
 *    two decimals by the function that computes it. A rounded value is never
 *    rounded again — `roundMoney` is idempotent.
 * 2. **Totals are the sum of the rounded components.** Consequently
 *    `total === direct + overhead + profit + contingency + escalation` *exactly*
 *    (no hidden residual): a reader who adds the printed column always gets the
 *    printed total. This is `sumMoney`.
 * 3. **Averages, ratios and indices are computed from unrounded values** and only
 *    rounded for display; they are never used to build a total.
 * 4. **Half-way values round away from zero** (`2.345 → 2.35`, `-2.345 → -2.35`),
 *    which is the convention expected in Iranian cost sheets (گرد کردن به بالا
 *    در نیم‌ریال).
 * 5. **Non-finite input never propagates.** `NaN` and `±Infinity` collapse to `0`
 *    and the caller keeps a finite number; the engine reports the anomaly through
 *    its diagnostics instead of printing `NaN` in a report.
 *
 * Compact display (`formatCompact`, e.g. «۱۲٫۳ میلیارد») rounds again for
 * readability — that is a *presentation* choice, not an accounting one, and the
 * full precision value is always available in the XLSX/JSON exports.
 */

/** Number of decimals kept for monetary values (IRR). */
export const MONEY_DECIMALS = 2;

const FACTOR = 10 ** MONEY_DECIMALS;

/** Rounds a monetary value to `MONEY_DECIMALS`, half away from zero, once. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // `Number.EPSILON` compensates for binary representation error such as
  // 1.005 * 100 = 100.49999999999999: the nudge is applied *after* scaling, and
  // scaled by the magnitude, so genuine half-way values still round up.
  const shifted = Math.abs(value) * FACTOR;
  const nudged = shifted + Number.EPSILON * Math.max(1, shifted);
  const rounded = Math.round(nudged) / FACTOR;
  return value < 0 ? -rounded : rounded;
}

/** Sum of already-rounded components, rounded once for the (tiny) residual. */
export function sumMoney(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += Number.isFinite(value) ? value : 0;
  return roundMoney(total);
}

/** True when two monetary figures agree to the last kept decimal. */
export function moneyEquals(a: number, b: number): boolean {
  return roundMoney(a) === roundMoney(b);
}

/** Percentage of a base amount, rounded once — used for overhead/profit/etc. */
export function percentOfMoney(base: number, percent: number): number {
  if (!Number.isFinite(base) || !Number.isFinite(percent)) return 0;
  return roundMoney((base * percent) / 100);
}
