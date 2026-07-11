/** Persisted wedding_journeys.progress money fields are always Korean won. */
export function storedMoneyToWon(value: unknown): number {
  const amount = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? Math.round(amount)
    : 0;
}
