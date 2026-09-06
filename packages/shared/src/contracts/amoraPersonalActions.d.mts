export type PersonalActionDraft = { title: string; description: string | null; dueDate: string | null };
export type PersonalAction = PersonalActionDraft & {
  id: string; ownerUserId: string; sourceMessageId: string; status: "open" | "done";
  revision: number; createdAt: string; updatedAt: string;
};
export type PersonalActionPage = { actions: PersonalAction[]; count: number; nextCursor: string | null };
export function isPersonalActionId(value: unknown): value is string;
export function normalizePersonalActionDraft(value: unknown): PersonalActionDraft | null;
export function parsePersonalAction(value: unknown, expectedOwnerId: string): PersonalAction | null;
export function parsePersonalActionPage(value: unknown, expectedOwnerId: string): PersonalActionPage | null;
export function parsePersonalActionReceipt(value: unknown, expectedOwnerId: string, expected:
  { kind: "save"; sourceMessageId: string; draft: PersonalActionDraft }
  | { kind: "update"; id: string; status: "open" | "done"; revision: number }
): PersonalAction | null;
export function isPersonalActionDeleteReceipt(value: unknown, expectedId: string): boolean;
