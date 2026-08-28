/**
 * 쉬지 않고 쓰는 사람에게도 자동 저장이 도는가.
 *
 * 자동 저장은 30초 간격 타이머인데, 그 타이머를 만드는 effect 가 `persistDraft` 를
 * 의존성으로 갖고 있었다. `persistDraft` 는 `title`·`content` 에 의존하는
 * `useCallback` 이라 **키를 칠 때마다 신원이 바뀐다.** 그래서 입력이 있을 때마다
 * 타이머가 정리되고 처음부터 다시 시작했다 — 30초 이상 손을 멈추지 않는 사람에게는
 * 자동 저장이 **한 번도** 돌지 않는다. 길게 쓰는 사람일수록 안 저장되는 셈이다.
 *
 * 이 파일은 소스를 읽어 **배선**을 고정한다. 처음에는 "렌더 하네스가 이 결함보다 훨씬
 * 크기 때문" 이라고 적었는데 **확인하지 않고 쓴 말이었고, 틀렸다.** 같은 디렉터리의
 * `page.test.tsx` 가 이미 이 컴포넌트를 `createRoot` + `act` 로 띄우고 있었다.
 *
 * 그리고 소스 정규식만으로는 부족하다는 것도 실측으로 드러났다 — ref 갱신 effect 의
 * 의존성을 `[persistDraft]` → `[]` 로 바꾸면 자동 저장이 **100% 죽는데** 이 파일이
 * 전부 초록이었다. 그래서 **동작**은 형제 파일 `../autoSaveActuallyRuns.test.tsx` 가
 * 실제로 타이머를 돌려 잰다. 이 파일은 그 위에 배선을 덧대는 몫만 한다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/app/(community)/community/post/write/page.tsx"),
  "utf8",
);

/** 줄 끝 주석까지 지운다 — 주석이 코드 대신 대답하면 안 된다. */
const CODE = SOURCE
  .split(String.fromCharCode(10))
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join(String.fromCharCode(10))
  .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 타이머 정리 블록의 본문. **매치 실패를 조용히 넘기지 않는다** — 정규식이 낡아
 * 매치가 깨지면 모든 변형이 CAUGHT 로 보고돼 검사 전체가 무의미해진다(실제로 당했다).
 */
function cleanupBlock(): string {
  const start = CODE.indexOf("if (autoSaveRef.current) clearInterval(autoSaveRef.current);");
  if (start < 0) throw new Error("타이머 정리 블록의 시작을 찾지 못했다");
  const end = CODE.indexOf("}, [isEditMode]);", start);
  if (end < 0) throw new Error("타이머 effect 의 끝을 찾지 못했다");
  return CODE.slice(start, end);
}

describe("자동 저장 타이머는 입력에 흔들리지 않는다", () => {
  it("타이머 effect 가 persistDraft 를 의존성으로 갖지 않는다", () => {
    // 이 한 줄이 결함의 전부였다. 다시 들어오면 30초 이상 쉬지 않는 사람이 잃는다.
    const timerEffect = CODE.match(
      /autoSaveRef\.current = setInterval\([\s\S]*?\}, \[([^\]]*)\]\);/,
    );
    expect(timerEffect, "자동 저장 타이머 effect 를 찾지 못했다").not.toBeNull();
    expect(timerEffect?.[1]).not.toContain("persistDraft");
  });

  it("타이머는 최신 persistDraft 를 ref 로 읽는다", () => {
    // 의존성만 빼면 타이머가 첫 렌더의 클로저를 영원히 들고 있어, 그때는 제목·본문이
    // 비어 있으므로 `persistDraft` 가 늘 false 를 돌려주고 **한 번도 저장되지 않는다.**
    //
    // 파일 전체에 문자열이 있는지로 물으면 안 된다 — 정리 블록에도 같은 호출이 있어서
    // 타이머 안쪽을 바꿔도 통과한다(변형 검사가 그것을 잡았다). 타이머 **안**을 본다.
    const intervalBody = CODE.match(
      /autoSaveRef\.current = setInterval\(\(\) => \{([\s\S]*?)\}, 30000\);/,
    );
    expect(intervalBody, "setInterval 콜백을 찾지 못했다").not.toBeNull();
    expect(intervalBody?.[1]).toContain("persistDraftRef.current()");
    expect(intervalBody?.[1]).not.toMatch(/(?<!Ref\.current)\bpersistDraft\(\)/);
  });

  it("일부러 지운 뒤에는 언마운트 저장을 하지 않는다", () => {
    // 발행 성공은 `removeItem(draftKey)` → `router.push` → 언마운트 순서다.
    // 가드가 없으면 언마운트 저장이 **방금 발행한 내용을 초안으로 되살려서**
    // 사용자가 같은 글을 두 번 올리게 된다. 이 수정을 만들면서 실제로 만들 뻔했다.
    expect(CODE).toContain("draftIntentionallyClearedRef");
    expect(cleanupBlock()).toContain("!draftIntentionallyClearedRef.current");
    // 초안을 지우는 모든 자리에서 표시가 서야 한다. 한 곳만 빠뜨리면 그 경로로 되살아난다.
    const removals = CODE.match(/localStorage\.removeItem\(draftKey\);/g) ?? [];
    const marks = CODE.match(/draftIntentionallyClearedRef\.current = true;/g) ?? [];
    expect(marks.length, `초안 삭제 ${removals.length}곳 중 표시가 ${marks.length}곳`)
      .toBeGreaterThanOrEqual(2);
  });

  it("화면을 떠날 때 한 번 더 저장한다", () => {
    // 타이머만 있으면 마지막 30초가 통째로 사라진다. 뒤로가기·탭 이동은
    // `beforeunload` 가 잡지 못한다.
    //
    // 창을 넉넉히 잡는다. 처음에는 `{0,200}` 이었는데 정리 블록에 가드가 하나
    // 늘자 매치가 통째로 실패했고, **깨진 테스트가 모든 변형을 CAUGHT 로 보고**해
    // 변형 검사 결과 전체를 무효로 만들었다.
    expect(cleanupBlock(), "타이머 정리 블록을 찾지 못했다").toContain(
      "persistDraftRef.current()",
    );
  });
});
