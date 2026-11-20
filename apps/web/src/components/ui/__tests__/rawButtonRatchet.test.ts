import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 손으로 만든 `<button>`은 **늘어나지 않는다.**
 *
 * ## 왜 이런 모양의 가드인가
 *
 * 2026-08-20 실측: 제품 코드의 `<button>` 702개 중 정적 className을 가진 것들이 서로 다른
 * 조합 **466종**을 쓰고, 그중 **90%가 딱 한 번씩만** 쓰인다. 색이 흩어진 게 아니라
 * 버튼을 매번 새로 쓰고 있었다.
 *
 * 이걸 "앞으로 raw `<button>` 금지"로 막으면 702곳이 한꺼번에 빨개진다. 그렇다고 다 옮기는
 * 것은 466종을 4종으로 줄이는 **재디자인**이라, 디자인이 확정되기 전에 할 일이 아니다.
 *
 * 그래서 래칫(ratchet)으로 막는다 — **지금보다 늘어나면 실패**한다. 새 코드는 프리미티브를
 * 쓸 수밖에 없고, 기존 코드는 준비된 화면부터 하나씩 옮기면 된다. 옮길 때마다 숫자가
 * 줄어드니 진행 상황이 저절로 기록된다.
 *
 * ## 늘려야 할 때
 *
 * 없다. 프리미티브가 못 하는 게 있으면 프리미티브를 고쳐라 — 그게 프리미티브를 만든
 * 이유다. 정말 예외가 필요하면 **왜 프리미티브로 안 되는지**를 여기 주석에 적고 올려라.
 *
 * ## 줄었을 때
 *
 * `BASELINE`을 새 숫자로 낮춰라. 낮추지 않으면 다음 사람이 다시 늘릴 여지가 그만큼 생긴다.
 *
 * **다만 줄었다고 실패시키지는 않는다.** 처음에는 하한(`>= BASELINE`)도 걸었는데,
 * 그러면 래칫이 아니라 **701 고정핀**이 된다 — 버튼을 지우기만 해도 빌드가 깨지고,
 * 각자 버튼을 줄인 두 브랜치를 합치면 양쪽 다 초록이었는데 main이 빨개진다.
 * 낮추는 것은 사람이 리뷰에서 챙길 일이지 빌드를 세울 일이 아니다.
 * (2026-08-20 적대 검토 지적. 하한을 건 것은 내 설계 실수였다.)
 *
 * ## 세는 방식 — 주석과 문자열도 함께 센다 (일부러)
 *
 * 적대 검토가 "주석 안의 `<button`도 세니 마이그레이션 메모 한 줄이 빌드를 세운다"고
 * 지적했다. 맞는 지적이라 주석·문자열을 지우고 세도록 고쳐봤다. **그랬더니 더 틀렸다.**
 *
 * 정규식으로 문자열을 지우면 JSX 텍스트 안의 작은따옴표가 문자열을 열어버려 그 뒤 코드를
 * 통째로 삼킨다. 실측:
 *
 *   app/(auth)/login/page.tsx                       11개 → 0개
 *   app/(community)/community/post/write/page.tsx   19개 → 0개
 *   app/(community)/community/cohort/[id]/page.tsx  27개 → 5개
 *   전체                                           701개 → 606개
 *
 * 로그인 화면에 버튼이 0개일 리 없다. 즉 "정확해 보이는" 606은 쓰레기다.
 *
 * 래칫은 절대값이 아니라 **방향**을 지키는 장치다. 세는 방법이 일정하기만 하면 늘었는지는
 * 정확히 알 수 있다. 그래서 단순 문자열 검색을 유지한다 — 주석까지 세는 것은 알려진
 * 오차이고, 주석 한 줄로 카운트가 흔들리는 것은 그 오차를 감수하는 값이다.
 */

/**
 * 제품 코드의 raw `<button>` 상한. **줄이는 방향으로만** 바꾼다.
 *
 * 세는 방식은 단순 문자열 검색이라 주석이나 문자열 안의 `<button`도 함께 센다. 래칫은
 * 절대값이 아니라 **방향**을 지키는 장치이므로 그래도 된다 — 세는 방법이 일정하기만
 * 하면 늘었는지 줄었는지는 정확하다. (이 사실을 모르고 손으로 계산했다가 1개 틀렸다.)
 *
 * ## 이 숫자가 무엇인지 — 실측으로 다시 적는다 (2026-08-21)
 *
 * 한동안 여기에 "708은 `origin/main` 기준"이라고 적혀 있었다. **틀린 말이었다.**
 * 세어 보면 `origin/main`은 703이고, 708은 이 브랜치(main + 첫 실행 동선)의 값이다.
 * 차이 5개가 어디서 왔는지 파일 단위로 대조했다:
 *
 *   +2  app/(app)/AppClientLayout.tsx          (1→3)
 *   +3  components/invite/InviteCodePanel.tsx  (0→3, 이 브랜치가 만든 파일)
 *   +1  components/onboarding/PreparationStageSelect.tsx (0→1, 같음)
 *   -1  app/(app)/settings/page.tsx            (27→26)
 *
 * 즉 남의 코드가 아니라 **이 브랜치가 손으로 만든 버튼 6개**다. 래칫이 막으라고 있는
 * 바로 그것인데, 병합할 때 근거 없이 상한만 올려서 통과시켰다. 아래에 근거를 적는다 —
 * 위 "늘려야 할 때" 절이 요구하는 것이 이것이다.
 *
 * ## 예외 근거 — 왜 이 6개는 프리미티브로 안 되는가
 *
 * 여섯 다 **Button에 새 변형을 추가해야** 옮길 수 있다. 변형을 늘리는 것은 디자인
 * 결정이고, 디자인이 확정되기 전에는 하지 않기로 한 것이 이 래칫을 만든 이유다.
 *
 *   - `PreparationStageSelect` — `aria-pressed`가 달린 전체폭 **선택 카드**다.
 *     Button의 primary/secondary/ghost/icon 어디에도 "고른 상태"가 없다.
 *   - `InviteCodePanel` 3개 — 복사에 성공하면 초록으로 바뀌는 **성공 상태**를 가진다.
 *     Button에 성공 상태가 없고, 상태별 색을 className으로 밀어 넣으면 프리미티브를
 *     쓰는 의미가 사라진다.
 *   - `AppClientLayout` 2개 — 하나는 원형 **FAB**(고정 위치·크기 고정), 하나는 첫마디
 *     미리보기를 통째로 누르는 **글자 영역**이다. 둘 다 버튼처럼 안 생겼고 그게 의도다.
 *
 * 디자인이 확정되면 위 세 가지(선택 상태·성공 상태·FAB)를 Button 변형으로 올리고
 * 이 예외를 지운다. 그때 숫자는 702로 내려간다.
 *
 * ## 병합할 때
 *
 * 이 값은 **트리마다 다르다** — `origin/main`은 703, 디자인 시스템 분리 브랜치도 703,
 * 여기는 708이다. 그래서 병합하면 이 줄에서 충돌이 난다. 그건 고장이 아니라 래칫이
 * 시키는 일이다: **합친 트리를 실제로 세서** 그 값을 넣어라. 큰 쪽을 반사적으로
 * 고르지 마라 — 그게 이 주석이 한 번 거짓이 된 경위다.
 */
// 2026-09-11: 승인된 HTML 화면의 신규 버튼 13곳을 공통 Button으로 옮겼다.
// 기존 화면에서 제거한 버튼까지 반영한 합친 트리의 실측값으로 상한을 낮춘다.
//
// 2026-09-30 (웨딩코드 4.0): 705 -> 708. 늘어난 3개는 **라디오 칸**이다.
//   components/wedding-code/v40/ChoiceInput.tsx, PairInput.tsx, ReactInput.tsx
// 예외 근거 - 왜 프리미티브로 안 되는가:
//   - 셋 다 `role="radio"` 와 `aria-checked` 를 단 **라디오 그룹의 한 칸**이다(방향키 이동, 한 칸만 탭 정지). 눌러서 무언가를 실행하는
//     단추가 아니라 고르는 칸이라, 단추 줄의 primary/secondary/ghost/icon 어디에도 맞지 않는다.
//   - Button 은 `whitespace-nowrap`, 고정 최소 높이, 가로 여백을 기본으로 깔고 className 을 **덧붙이기만** 한다(충돌하는 유틸리티를
//     지우지 않는다). ChoiceInput 의 칸은 보기 문장 전체(두세 줄로 접힘)라 줄바꿈 금지가 바로 깨지고, PairInput(카드마다 세 칸)과
//     ReactInput(다섯 칸)의 칸은 좁은 격자라 기본 가로 여백이 칸 폭을 넘친다.
//   - 이 칸들을 위한 변형(고른 상태를 가진 칸)을 Button 에 올리는 것은 디자인 결정이라 이 브랜치에서 하지 않는다. 이 파일이 세운 원칙과
//     같은 이유로 PreparationStageSelect(선택 카드) 예외가 이미 위에 있다. 선택 상태 변형이 생기면 이 셋도 함께 옮기고 숫자는 705 로 돌아간다.
// 이 값은 합친 트리를 실제로 세어 넣었다(main 705 + 이 3개).
//
// 2026-11-20 (로그인 화면 청첩장 디자인): 708 -> 703. 같은 방식으로 세면 main(98c3e1184)이 이미 705 였다(위 3칸이 들어온 뒤
// 다른 곳에서 줄어든 만큼 상한을 내리지 않았다). 로그인과 새 비밀번호 화면의 제출 단추 둘을 공용 Button(ink, pill-56)으로
// 옮겨 703 이 됐다. 합친 트리를 실제로 세어 넣었다.
const BASELINE = 703;

const SOURCE_ROOT = path.join(process.cwd(), "src");

/** 프리미티브 자신은 raw `<button>`을 낸다. 그게 이 파일의 일이다. */
const EXEMPT = [path.join("src", "components", "ui", "Button.tsx")];

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);
}

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function scan(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;

  for (const file of collect(SOURCE_ROOT)) {
    if (isTestFile(file)) continue;
    const relative = path.relative(process.cwd(), file);
    if (EXEMPT.some((exempt) => relative === exempt)) continue;

    const matches = readFileSync(file, "utf8").match(/<button\b/g);
    if (!matches) continue;
    total += matches.length;
    byFile.push([relative, matches.length]);
  }

  return { total, byFile: byFile.sort((a, b) => b[1] - a[1]) };
}

/** 소스 트리 전수 스캔은 한 번이면 된다 — 테스트마다 다시 읽으면 그만큼 느려진다. */
let cached: ReturnType<typeof scan> | null = null;

function countRawButtons(): ReturnType<typeof scan> {
  cached ??= scan();
  return cached;
}

describe("손으로 만든 버튼은 늘지 않는다", () => {
  it("측정기가 살아 있다", () => {
    // 스캔이 비면 total이 0이 되고 아래 단언이 **조용히 통과**한다. 그쪽을 먼저 막는다.
    const { total, byFile } = countRawButtons();
    expect(byFile.length).toBeGreaterThan(50);
    expect(total).toBeGreaterThan(300);
  });

  it("기준치를 넘지 않는다", () => {
    const { total, byFile } = countRawButtons();

    expect(
      total,
      `raw <button>이 ${total}개입니다(기준 ${BASELINE}). `
        + `새 버튼은 \`@/components/ui/Button\`을 쓰세요. `
        + `가장 많은 파일: ${byFile.slice(0, 3).map(([f, n]) => `${f}(${n})`).join(", ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("줄었으면 알려주되 빌드를 세우지는 않는다", () => {
    const { total } = countRawButtons();

    if (total < BASELINE) {
      // 실패시키지 않는 이유는 위 독블록 "줄었을 때" 참고. 하한을 걸면 래칫이 아니라
      // 고정핀이 되어, 버튼을 지우기만 해도 빌드가 깨진다.
      console.warn(
        `[ratchet] raw <button>이 ${total}개로 줄었습니다(기준 ${BASELINE}). `
          + `rawButtonRatchet.test.ts의 BASELINE을 ${total}로 낮춰주세요.`,
      );
    }

    expect(total).toBeLessThanOrEqual(BASELINE);
  });
});
