export interface ToolExecutionContext {
  coupleId: string;
  currentUserId?: string;
  signal?: AbortSignal;
  weddingContext: {
    weddingDate: string | null;
    budget: number;
    venue: string | null;
    progress: Record<string, { category: string; status: string }>;
  };
}

export function formatWon(amount: number): string {
  return `${Math.round(amount / 10000).toLocaleString()}만원`;
}
