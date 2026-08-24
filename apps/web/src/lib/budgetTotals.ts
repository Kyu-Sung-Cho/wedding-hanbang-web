/**
 * 예산 합계를 한 곳에서 센다.
 *
 * 세는 규칙은 **예산 화면이 정본**이다(BudgetContent 의 totalSpent/totalAllocated):
 * 사용자가 지운 항목(`progress.__hidden`)은 빼고, 직접 추가한 항목(`custom_`)은
 * 넣는다.
 *
 * 예전에는 표면마다 따로 셌다. 2026-08-24 에 아모라 쪽만 커스텀을 포함하도록
 * 고치자, **한 장의 예산 카드 안에서 숫자가 둘로 갈렸다** — 본문은 커스텀을
 * 포함한 합계를 말하는데 바로 아래 막대 위젯은 고정 카테고리만 더한 더 작은
 * 값을 보여줬다. 사용자에게는 아모라가 자기 말을 뒤집는 것으로 보인다.
 */

const CUSTOM_KEY_PREFIX = "custom_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWonAmount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function hiddenKeys(progress: Record<string, unknown>): ReadonlySet<string> {
  return new Set(
    Array.isArray(progress.__hidden)
      ? (progress.__hidden as unknown[]).filter(
          (key): key is string => typeof key === "string",
        )
      : [],
  );
}

/**
 * 합계에 들어가는 항목만 돌려준다.
 *
 * `fixedKeys` 는 호출하는 표면이 아는 고정 카테고리 키 목록이다. 표면마다
 * 목록이 조금씩 달라서(22개 / 21개) 인자로 받는다. 커스텀 항목은 키 접두사로
 * 고르므로 목록이 필요 없다.
 */
export function listCountedBudgetEntries(
  progress: unknown,
  fixedKeys: readonly string[],
): { key: string; budget: number; spent: number }[] {
  if (!isRecord(progress)) return [];
  const hidden = hiddenKeys(progress);
  const entries: { key: string; budget: number; spent: number }[] = [];

  const push = (key: string) => {
    if (hidden.has(key)) return;
    const item = progress[key];
    if (!isRecord(item)) return;
    entries.push({
      key,
      budget: readWonAmount(item.budget),
      spent: readWonAmount(item.spent),
    });
  };

  for (const key of fixedKeys) push(key);
  for (const key of Object.keys(progress)) {
    if (!key.startsWith(CUSTOM_KEY_PREFIX)) continue;
    if (key.length === CUSTOM_KEY_PREFIX.length) continue;
    push(key);
  }
  return entries;
}

export function sumRecordedSpend(
  progress: unknown,
  fixedKeys: readonly string[],
): number {
  return listCountedBudgetEntries(progress, fixedKeys)
    .reduce((sum, entry) => sum + entry.spent, 0);
}

export function sumAllocatedBudget(
  progress: unknown,
  fixedKeys: readonly string[],
): number {
  return listCountedBudgetEntries(progress, fixedKeys)
    .reduce((sum, entry) => sum + entry.budget, 0);
}
