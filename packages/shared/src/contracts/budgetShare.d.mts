export declare function withPercents<T extends { amount: number }>(
  items: readonly T[],
  total: number,
): (T & { percent: number })[];

export declare function formatManwon(won: number): string;

export declare function formatWonExact(won: number): string;

export declare function formatPercentCell(percent: number, amount: number): string;

export interface PayerSides {
  brideSide: number;
  groomSide: number;
  shared: number;
}

export declare function foldPayerSides(
  payerSummary: Partial<Record<string, number>> | null | undefined,
): PayerSides;
