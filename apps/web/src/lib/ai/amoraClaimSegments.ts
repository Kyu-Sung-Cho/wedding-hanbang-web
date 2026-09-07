// 판정 단위는 유지하되, 남길 문장의 표·소수점·URL·줄바꿈은 원문 그대로 보존한다.
export function splitAmoraClaimSegments(text: string): { claim: string; source: string }[] {
  const segments: { claim: string; source: string }[] = [];
  let start = 0;
  for (const boundary of text.matchAll(/(?<=[.!?。！？])\s*|\n+/gu)) {
    const end = boundary.index + boundary[0].length;
    if (end <= start) continue;
    segments.push({ claim: text.slice(start, boundary.index).trim(), source: text.slice(start, end) });
    start = end;
  }
  if (start < text.length) {
    segments.push({ claim: text.slice(start).trim(), source: text.slice(start) });
  }
  return segments;
}
