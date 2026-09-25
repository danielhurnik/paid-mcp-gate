// Money is stored and computed as integer micro-dollars (1 USD = 1_000_000 micros)
// so that sub-cent prices never accumulate floating point drift in the ledger.

export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

/** "$0.25", or "$0.0125" when the amount has sub-cent precision. */
export function formatUsd(micros: number): string {
  const decimals = Math.abs(micros) % 10_000 === 0 ? 2 : 4;
  const sign = micros < 0 ? "-" : "";
  return `${sign}$${(Math.abs(micros) / MICROS_PER_USD).toFixed(decimals)}`;
}
