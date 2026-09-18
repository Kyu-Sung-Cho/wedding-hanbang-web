export type SharedActionStatus = "open" | "done" | "dismissed";
export type SharedActionPriority = "high" | "medium" | "low";
export type SharedActionSource = "chat" | "quote" | "schedule" | "budget" | "guardrail" | "manual";

export type SharedAction = {
  id: string;
  title: string;
  /** 없으면 "". */
  description: string;
  /** 사용자가 쓴 예정 시기 원문(날짜로 바꾸지 않는다). 없으면 "". */
  dueDate: string;
  /** 저장된 분야 키. 21개 체크리스트 분야 밖의 값(예: "general")도 그대로 둔다. 없으면 "". */
  categoryKey: string;
  /** 모르는 출처면 null. */
  source: SharedActionSource | null;
  /** "/" 로 시작하는 저장된 경로. 없으면 "". 화면 이동 허용 여부는 따로 판정한다. */
  href: string;
  status: SharedActionStatus;
  priority: SharedActionPriority;
  updatedAt: string;
};

export type SharedActionCreateFields = { title: string; categoryKey?: string; description?: string; dueDate?: string };
export type SharedActionCreateScope = { requestId: string; expectedOwnerId: string; expectedCoupleId: string };
export type SharedActionCreateBody = {
  title: string;
  category_key?: string;
  description?: string;
  due_date?: string;
  status: "open";
  priority: "medium";
  source: "manual";
  requestId: string;
  expectedOwnerId: string;
  expectedCoupleId: string;
};
export type SharedActionDraft = { title: string; categoryKey: string; description: string; dueDate: string };
export type SharedActionUpdate = {
  status?: SharedActionStatus;
  title?: string;
  category_key?: string;
  description?: string;
  due_date?: string;
};

export declare const SHARED_ACTION_ID_PATTERN: RegExp;
export declare const SHARED_ACTION_TITLE_MAX: 120;
export declare const SHARED_ACTION_DESCRIPTION_MAX: 500;
export declare const SHARED_ACTION_DUE_MAX: 40;
export declare const SHARED_ACTION_STATUS_COLUMNS: ReadonlyArray<{ readonly status: SharedActionStatus; readonly label: string; readonly rule: string }>;
export declare const SHARED_ACTION_STATUS_ANNOUNCEMENTS: Readonly<Record<SharedActionStatus, string>>;
export declare const SHARED_ACTION_SOURCE_LABELS: Readonly<Record<SharedActionSource, string>>;
export declare function sharedActionSourceLabel(source: unknown): string;
export declare function isSharedActionId(value: unknown): value is string;
export declare function normalizeLikeServer(raw: unknown, maxLength: number): string | null;
export declare function parseSharedAction(entry: unknown): SharedAction | null;
export declare function parseSharedActionList(payload: unknown): SharedAction[];
export declare function buildManualCreateBody(fields: SharedActionCreateFields | null | undefined, scope: SharedActionCreateScope): SharedActionCreateBody | null;
export declare function matchesManualCreateReceipt(payload: unknown, body: SharedActionCreateBody): SharedAction | null;
export declare function buildActionUpdateDiff(
  original: Pick<SharedAction, "title" | "categoryKey" | "description" | "dueDate">,
  draft: SharedActionDraft | null | undefined,
): SharedActionUpdate | null;
export declare function matchesActionUpdateReceipt(payload: unknown, id: string, updates: SharedActionUpdate): SharedAction | null;
