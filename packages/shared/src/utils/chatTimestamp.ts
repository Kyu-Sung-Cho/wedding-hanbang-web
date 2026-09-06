/** PostgreSQL timestamptz의 소수 6자리를 보존해 메시지와 화면 정리 커서를 비교한다. */
export function compareChatTimestamps(left: string, right: string): -1 | 0 | 1 | null {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  if (!Number.isFinite(leftMilliseconds) || !Number.isFinite(rightMilliseconds)) return null;
  if (leftMilliseconds < rightMilliseconds) return -1;
  if (leftMilliseconds > rightMilliseconds) return 1;

  // Date.parse는 밀리초 뒤를 버린다. UTC offset은 위에서 정규화하고,
  // 같은 밀리초일 때만 남은 3자리를 비교해 큰 epoch 정수의 반올림도 피한다.
  const microsecondRemainder = (value: string): number => {
    const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value)?.[1] ?? "";
    return Number(fraction.padEnd(6, "0").slice(3, 6));
  };
  const leftRemainder = microsecondRemainder(left);
  const rightRemainder = microsecondRemainder(right);
  return leftRemainder < rightRemainder ? -1 : leftRemainder > rightRemainder ? 1 : 0;
}
