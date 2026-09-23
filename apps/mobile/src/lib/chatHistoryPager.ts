import { compareChatTimestamps } from "@hanbang/shared";
import type { ChatScope, ChatVisibility } from "./chatPrivacyScope";

type HistoryRow = { id: string; visibility: ChatVisibility; created_at?: string };
export type ChatHistoryCursor = { id: string; createdAt: string };
export type ChatHistoryPageState = { loading: boolean; hasMore: boolean; error: string | null };
export type ChatHistoryPages = Record<ChatScope, ChatHistoryPageState>;
export const createEmptyChatHistoryPages = (): ChatHistoryPages => ({
  shared: { loading: false, hasMore: false, error: null },
  private: { loading: false, hasMore: false, error: null },
});

export function compareChatHistoryRows(left: HistoryRow, right: HistoryRow): number {
  return compareChatTimestamps(left.created_at ?? "", right.created_at ?? "") || left.id.localeCompare(right.id);
}

export function mergeOlderChatHistory<T extends HistoryRow>(current: readonly T[], older: readonly T[]): T[] {
  return [...new Map([...older, ...current].map(message => [message.id, message])).values()].sort(compareChatHistoryRows);
}

export function chatHistoryBeforeFilter(cursor: ChatHistoryCursor): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor.id)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
    || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error("Invalid history cursor");
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

type PagerOptions<T extends HistoryRow> = {
  initialRows: readonly T[];
  hasMore: boolean;
  visibility: Record<ChatScope, ChatVisibility | null>;
  isCurrent(): boolean;
  verifyBoundary(): Promise<boolean>;
  readPage(request: { visibility: ChatVisibility; before: ChatHistoryCursor | null; limit: number; signal: AbortSignal }): Promise<T[]>;
  onPage(rows: T[]): void;
  onState(state: ChatHistoryPages): void;
  timeoutMs?: number;
};

/** 초기 200개와 복구용 보충 행을 구분한다. 보충 행을 커서로 삼으면 그 사이 기록을 건너뛴다. */
export function createMobileChatHistoryPager<T extends HistoryRow>(options: PagerOptions<T>) {
  let alive = true;
  let pages = createEmptyChatHistoryPages();
  const pending = new Map<ChatScope, () => void>();
  const cursors: Record<ChatScope, ChatHistoryCursor | null> = { shared: null, private: null };
  const patch = (scope: ChatScope, next: Partial<ChatHistoryPageState>) => {
    pages = { ...pages, [scope]: { ...pages[scope], ...next } };
    options.onState(pages);
  };
  const current = () => alive && options.isCurrent();
  for (const scope of ["shared", "private"] as const) {
    const oldest = options.initialRows.filter(row => row.visibility === options.visibility[scope]).sort(compareChatHistoryRows)[0];
    if (oldest?.created_at) cursors[scope] = { id: oldest.id, createdAt: oldest.created_at };
    pages[scope].hasMore = options.hasMore && options.visibility[scope] !== null;
  }
  options.onState(pages);
  return {
    getState: () => pages,
    dispose: () => { alive = false; pending.forEach(cancel => cancel()); pending.clear(); },
    async load(scope: ChatScope): Promise<boolean> {
      const visibility = options.visibility[scope];
      if (!current() || !visibility || pages[scope].loading || !pages[scope].hasMore) return false;
      patch(scope, { loading: true, error: null });
      const controller = new AbortController();
      let cancel = () => {};
      const deadline = new Promise<never>((_resolve, reject) => {
        cancel = () => { reject(new Error("History load ended")); controller.abort(); };
      });
      const configuredTimeout = options.timeoutMs;
      const timeoutMs = typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30_000;
      const timer = setTimeout(cancel, timeoutMs);
      const wait = <R,>(promise: Promise<R>): Promise<R> => Promise.race([promise, deadline]);
      pending.set(scope, cancel);
      try {
        if (!await wait(options.verifyBoundary()) || !current()) return false;
        const rows = await wait(options.readPage({ visibility, before: cursors[scope], limit: 50, signal: controller.signal }));
        if (!current() || !await wait(options.verifyBoundary()) || !current()) return false;
        const ordered = rows.slice().sort(compareChatHistoryRows);
        options.onPage(ordered);
        const oldest = ordered[0];
        if (oldest?.created_at) cursors[scope] = { id: oldest.id, createdAt: oldest.created_at };
        patch(scope, { hasMore: rows.length === 50 });
        return true;
      } catch {
        if (current()) patch(scope, { error: "이전 대화를 불러오지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요." });
        return false;
      } finally {
        clearTimeout(timer);
        pending.delete(scope);
        if (current()) patch(scope, { loading: false });
      }
    },
  };
}
