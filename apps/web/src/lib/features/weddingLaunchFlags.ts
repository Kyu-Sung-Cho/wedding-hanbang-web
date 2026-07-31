function isExactTrue(value: string | undefined): boolean {
  return value === "true";
}

export function isWeddingCourtEnabled(): boolean {
  return isExactTrue(process.env.WEDDING_COURT_ENABLED);
}

export function isWeddingPaymentLedgerEnabled(): boolean {
  return isExactTrue(process.env.WEDDING_PAYMENT_LEDGER_ENABLED);
}
