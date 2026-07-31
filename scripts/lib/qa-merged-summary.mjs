/**
 * `qa:merged`의 마지막 줄을 만든다.
 *
 * ## 왜 따로 떼어놨나
 *
 * 첫 판이 「주의: 이 결과는 origin/main에 대한 것이 아니다」를 찍고 **바로 다음 줄에**
 * 「머지된 결과가 깨끗하다」고 단언했다. 사람은 마지막 줄을 읽는다 — 경고를 위에 적어두는
 * 것으로는 거짓 초록불을 막지 못한다.
 *
 * 그리고 이 문구를 13분짜리 서브프로세스로 검증하는 것은 잘못된 설계다. 순수 함수라
 * 테스트가 1밀리초에 끝나고, 조합(플래그 여러 개)을 전부 확인할 수 있다.
 */

/**
 * @param {{
 *   branch: string,
 *   shortHead: string,
 *   dirty: boolean,
 *   headMatchesRemote: boolean,
 *   flags: Set<string>,
 *   passedCount: number,
 *   failures: readonly string[],
 *   minutes: number,
 * }} input
 * @returns {{ lines: string[], exitCode: 0 | 1, guaranteed: boolean }}
 *   `guaranteed`는 「이 결과가 머지된 origin/main에 대한 보증인가」다.
 */
export function buildQaMergedSummary(input) {
  const { branch, shortHead, dirty, headMatchesRemote, flags, passedCount, failures, minutes } =
    input;

  const caveats = [];
  if (dirty && flags.has("--allow-unclean")) {
    caveats.push("커밋 안 된 변경이 있어 검사 대상이 origin/main이 아니다");
  }
  if (branch !== "main" && flags.has("--allow-branch")) {
    caveats.push(`main이 아닌 "${branch}"를 검사했고 origin/main과 대조하지 않았다`);
  }
  if (!headMatchesRemote && flags.has("--allow-branch")) {
    caveats.push("HEAD가 origin/main과 다르다");
  }
  if (flags.has("--skip-build")) {
    caveats.push("빌드를 건너뛰어 프리렌더 오류는 검증되지 않았다");
  }
  if (flags.has("--no-fetch")) {
    caveats.push("원격을 조회하지 않아 origin/main이 최신인지 모른다");
  }

  const lines = [
    "──────────────────────────────────────────",
    `검사 대상: ${branch} @ ${shortHead}`,
    `통과 ${passedCount} · 실패 ${failures.length} · ${minutes}분`,
  ];

  if (failures.length > 0) {
    lines.push("", "실패");
    for (const failure of failures) lines.push(`  - ${failure}`);
    return { lines, exitCode: 1, guaranteed: false };
  }

  if (caveats.length > 0) {
    lines.push("", `${shortHead} 검사 통과 — 다만 이건 머지된 main에 대한 보증이 아니다:`);
    for (const caveat of caveats) lines.push(`  · ${caveat}`);
    lines.push("보증을 받으려면 플래그 없이 다시 돌린다.");
    return { lines, exitCode: 0, guaranteed: false };
  }

  lines.push("", `${shortHead} 통과 — 머지된 결과가 깨끗하다.`);
  return { lines, exitCode: 0, guaranteed: true };
}
