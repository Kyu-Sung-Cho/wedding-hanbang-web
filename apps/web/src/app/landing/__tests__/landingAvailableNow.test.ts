// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  weddingCodeSceneCountLabel,
} from "@/lib/weddingCode/scene/config";

/**
 * "지금 가입 없이 되는 것" 섹션의 계약.
 *
 * 이 섹션은 랜딩에서 유일하게 **오늘 쓸 수 있는 것**을 약속한다. 그래서 여기 실린
 * 경로가 로그인 뒤로 숨거나 사라지면 그 즉시 거짓말이 된다. 소스 텍스트로 막을 수
 * 있는 것만 여기서 막고, "실제로 로그인 없이 200이 나오는가"는 브라우저 QA
 * (`scripts/landing-a11y-qa.mjs`와 같은 계열)로 확인한다 — 정적 검사로는 증명할 수
 * 없는 성질이다.
 *
 * 전수 조사(2026-08-06)에서 아모라 도구 36개 중 상당수가 기능 플래그·게이트로
 * 막혀 있었고, 검증기가 97건 중 31건의 가용성 주장을 정정했다. 코드에 있다는 것과
 * 오늘 쓸 수 있다는 것은 다르다.
 */

const appRoot = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(appRoot, p), "utf8");

const content = read("src/components/landing/redesign/landingContent.ts");
const section = read("src/components/landing/redesign/AvailableNowSection.tsx");
const page = read("src/app/landing/page.tsx");

/** availableNow 블록만 잘라 본다 — 같은 파일의 다른 목록도 `note:`를 쓴다.
 *
 *  끝 경계가 `export const preparationRecords`였는데 2026-08-27 개편으로 그 export가
 *  사라졌다. `indexOf`가 -1을 주면 `slice(start, -1)`이 되어 **파일 끝까지** 잘렸고,
 *  그 바람에 푸터의 `mailto:` 링크가 이 섹션의 href로 세어져 실패했다. 지금 이 배열
 *  바로 다음에 오는 export를 끝으로 삼는다.
 *
 *  대표 카드(`availableNowLead`)도 없어졌다. 섹션을 이끄는 문장은 이제
 *  `landingContent.availableNow`에 있고, 아래 "수량어" 검사가 그쪽을 따로 읽는다. */
const availableNowBlock = content.slice(
  content.indexOf("export const availableNow"),
  content.indexOf("export const footerLinks"),
);

/** 섹션을 이끄는 문장(eyebrow·title·body). 카드 개수를 소개하는 자리라 카드 배열과
 *  따로 검사한다 — 카드 본문에는 "세 가지"·"25편"처럼 개수와 무관한 수가 정상적으로
 *  들어 있어서, 둘을 한 덩어리로 세면 수량어 검사가 그것들에 걸려 넘어진다. */
const availableNowLead = content.slice(
  content.indexOf("  availableNow: {"),
  content.indexOf("  closing: {"),
);

/** 주석은 벗긴다. 왜 안 쓰는지 설명하려면 그 이름을 적어야 하는데,
 *  자기 설명에 걸려 넘어지는 가드는 가드가 아니다. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[\t ]*\/\/.*$/gmu, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");

/** 게이트로 막혀 있어 랜딩에 실으면 안 되는 영역(2026-08-06 조사). */
const GATED_SURFACES = [
  "/vendors",
  "/money",
  "/bookings",
  "/community/cohort",
  "/wedding-court",
];

describe("landing available-now section", () => {
  it("renders on the landing before the last call to action", () => {
    expect(page).toContain("<AvailableNowSection />");

    // 원래 이 단언은 `<PreparationResult />`(계정 베타 결과 미리보기)보다 **앞**일 것을
    // 요구했다. 그 컴포넌트는 2026-08-27 개편으로 삭제됐고, 새 순서는 계정 베타를
    // 설명하는 `<ConfirmSection />`을 오히려 앞에 둔다(page.tsx의 섹션 순서 주석이
    // 그 이유를 적어 뒀다 — ⑦은 "빈손으로 나가지 않게" 마지막 행동 직전에 둔다).
    //
    // 그래서 지키는 대상을 "계정 베타보다 앞"에서 **"마지막 행동을 부르기 전"**으로
    // 옮긴다. 의도는 같다: 처음 온 사람이 오늘 쓸 수 있는 것을 하나도 못 보고
    // 결정 앞에 서지 않게 한다. 이 목록이 마무리·푸터 뒤로 가라앉으면 실패한다.
    expect(
      page.indexOf("<AvailableNowSection />"),
      "지금 되는 것이 마지막 행동보다 뒤에 오면 처음 온 사람이 빈손으로 결정한다",
    ).toBeLessThan(page.indexOf("<ClosingAction />"));
    expect(page.indexOf("<ClosingAction />"), "마무리 섹션을 찾지 못했다")
      .toBeGreaterThan(-1);
  });

  it("lists only paths that were verified to open without login", () => {
    // 끝 경계를 못 찾으면 `slice(start, -1)`이 되어 블록이 파일 끝까지 넓어지고,
    // 푸터의 `mailto:` 까지 이 섹션의 링크로 세어진다 — 2026-08-27에 실제로 그렇게
    // 실패했다. 경계가 사라지면 그 자리에서 알아채도록 먼저 확인한다.
    expect(
      content.indexOf("export const footerLinks"),
      "availableNow 블록의 끝 경계를 찾지 못했다 — slice가 파일 끝까지 넓어진다",
    ).toBeGreaterThan(content.indexOf("export const availableNow"));

    const hrefs = [...availableNowBlock.matchAll(/href:\s*"([^"]+)"/gu)].map((m) => m[1]);
    expect(hrefs.length, "availableNow 항목이 없다").toBeGreaterThanOrEqual(4);

    for (const href of hrefs) {
      expect(href, "외부 링크는 이 섹션에 넣지 않는다").toMatch(/^\//u);
      for (const gated of GATED_SURFACES) {
        expect(href, `${href}는 게이트로 막힌 영역이다`).not.toContain(gated);
      }
    }

    // /community/quote-check는 307로 /wedding/... 으로 넘어간다. 리다이렉트를
    // 한 홉 태우면 첫 클릭이 느려지고 UTM도 흔들리므로 정식 경로를 쓴다.
    expect(hrefs, "리다이렉트되는 별칭 대신 정식 경로를 쓴다").not.toContain(
      "/community/quote-check",
    );
  });

  it("states an availability or storage fact on every card", () => {
    const notes = [...availableNowBlock.matchAll(/note:\s*"([^"]+)"/gu)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const note of notes) {
      expect(
        // "이용 전에 알아야 할 사실"의 범위: 저장 여부·데이터 출처·판정 안 함·
        // 무료 한도. 대표 카드는 "준비 기록에 남지 않아요 / 무료 이용에는 한도가
        // 있어요"로 말하므로 기록·한도·무료도 유효한 고지다.
        /저장|서버|출처|자료|점수|등급|판정|기록|한도|무료/u.test(note),
        `이용 전에 알아야 할 사실이 없는 카드가 있다: "${note}"`,
      ).toBe(true);
    }
  });

  it("never routes these cards through the Amora start tracker", () => {
    // TrackedLandingLink는 landing_amora_start_click을 쏘고 날짜 handoff를 지운다.
    // 이 카드들은 아모라를 열지 않으므로 둘 다 틀린 동작이 된다.
    expect(withoutComments(section)).not.toContain("TrackedLandingLink");

    // 원래 이 자리에는 `${secondaryLink}`(landingType.ts의 링크 레시피)를 쓰는지
    // 봤다. 2026-08-27 개편으로 공유 레시피가 `landingType.ts`에서 `notebook.tsx`로
    // 옮겨 갔고 — 지금 landingType.ts를 import하는 제품 파일은 0개다 — 링크는
    // 레시피 없이 인라인 클래스로 쓴다. 지키려던 것은 "이 섹션이 자기만의 문법을
    // 발명하지 않는다"이므로, 대상을 현재의 공유 프리미티브로 옮긴다.
    expect(section, "공유 프리미티브를 쓰지 않는다").toContain('from "./notebook"');
    for (const primitive of ["<Section", "<NoteCard", "bodyText", "noteText"]) {
      expect(section, `${primitive}을 쓰지 않고 자기 스타일을 만든다`).toContain(primitive);
    }
  });

  it("names the scene count the destination screen actually asks", () => {
    // 이 카드를 누르면 곧바로 웨딩코드 화면이 열린다. 여기 적힌 장면 수가 그 화면의
    // 문항 수와 다르면 한 클릭 만에 숫자가 달라진다 — 실제로 "열여섯"으로 적힌 채
    // 도착 화면은 "스무"였다.
    //
    // landingContent.ts는 클라이언트 컴포넌트가 import하므로 거기서 설정을 끌어오면
    // 문항 은행이 랜딩 번들에 실린다. 그래서 숫자는 손으로 적고, 대조는 여기서 한다.
    const live = weddingCodeSceneCountLabel(
      CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length,
    );
    expect(availableNowBlock, `라이브 설정은 ${live} 장면이다`)
      .toContain(`${live} 장면에 각자 답하면`);
    expect(availableNowBlock, `라이브 설정은 ${live} 장면이다`)
      .toContain(`${live} 장면 답해보기`);

    // 다른 표기가 함께 남아 있으면 위 두 단언은 통과하면서 화면에는 두 숫자가 보인다.
    // 주석은 벗기고 본다 — 왜 바꿨는지 설명하려면 옛 표기를 인용해야 하는데, 자기
    // 설명에 걸려 넘어지는 가드는 가드가 아니다. 실제 렌더에 닿는 문자열만 본다.
    const rendered = availableNowBlock
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[	 ]*\/\/.*$/gmu, "");
    for (const other of ["열두", "열여섯", "스무", "스물네"].filter((n) => n !== live)) {
      expect(rendered, `옛 표기 "${other}"가 남아 있다`).not.toContain(other);
    }
  });

  it("keeps unverified claims out of every landing surface, not just this section", () => {
    // 이 검사는 `availableNow` 블록만 보고 있었다. 그래서 카드에서는 "후기"를
    // 피해 놓고 바로 옆 커뮤니티 섹션 본문에는 그대로 쓴 것이 통과해 **라이브까지
    // 나갔다**. 금지어의 이유는 카드가 아니라 랜딩 전체에 적용된다 — 랜딩에서
    // "후기"는 우리 제품에 대한 사회적 증거로 읽힌다.
    //
    // 파일 이름을 손으로 적지 않고 디렉터리를 통째로 읽는다. 새 섹션이 생길 때마다
    // 목록에 추가하는 걸 잊으면 같은 구멍이 다시 난다.
    const redesignDir = resolve(appRoot, "src/components/landing/redesign");
    const everySurface = readdirSync(redesignDir)
      .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
      .map((f) => read(`src/components/landing/redesign/${f}`))
      .concat(page);

    // 주석은 렌더되지 않으므로 카피가 아니다. 벗기지 않으면 "왜 이 단어를 피했는지"
    // 적은 설명이 스스로 걸린다(이 저장소에서 네 번 반복됐다).
    const copyOnly = withoutComments(everySurface.join("\n"));
    const banned = ["후기", "만족도", "성공률", "1위", "최고", "보장", "절감"];
    for (const word of banned) {
      expect(copyOnly, `검증되지 않은 주장 "${word}"`).not.toContain(word);
    }
  });

  /**
   * 카피가 "아래 넷"이라고 하는데 카드가 다섯 장이면 랜딩이 첫 화면부터 세는 법을
   * 틀린다(2026-08-20 실측). 위의 `>= 4` 검사는 개수가 늘어도 통과하므로 수량어를
   * 잡지 못한다. 개수와 문구를 한 곳에 묶는다.
   *
   * 2026-08-27 개편이 그 묶는 방식을 바꿨다. 카드에 `id`가 없어졌고, 개수는 카피에
   * 손으로 적는 대신 **본문이 `availableNow.length`에서 센다**(AvailableNowSection).
   * 그래서 "카피의 수량어 == 카드 수"를 대조하는 대신, 그 대조가 필요 없는 구조인지를
   * 지킨다 — ① 본문이 배열 길이로 세고 ② 그 옆에 손으로 적은 수가 없어야 한다.
   * 둘 중 하나만 지키면 화면이 다시 두 개의 수를 말할 수 있다.
   */
  it("수량어가 실제 카드 수와 일치한다", () => {
    // `id:`가 사라졌으므로 카드마다 하나씩 있는 `cta: {`로 센다.
    const count = [...availableNowBlock.matchAll(/cta:\s*\{/gu)].length;
    expect(count, "availableNow 카드를 세지 못했다").toBeGreaterThanOrEqual(4);

    // ① 개수는 배열에서 나온다. 리터럴로 갈아 끼우면 이 단언이 먼저 깨진다.
    expect(section, "본문이 availableNow.length로 세지 않는다")
      .toContain("{availableNow.length}가지는");

    // ② 섹션을 이끄는 문장에는 개수를 말하는 다른 수가 없어야 한다. 카드 본문에는
    //    "세 가지"·"25편"·"12개"처럼 개수와 무관한 수가 정상적으로 들어 있으므로
    //    이끄는 문장(eyebrow·title·body)만 본다.
    expect(availableNowLead, "availableNow 카피를 찾지 못했다").toContain("계정 없이 지금 열려");

    const wrongWords = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱"].filter(
      (word) => availableNowLead.includes(word),
    );
    expect(
      wrongWords,
      `카드는 ${count}장인데 이끄는 문장이 "${wrongWords.join(", ")}"라고 한다`,
    ).toEqual([]);
    expect(availableNowLead, "이끄는 문장이 개수를 숫자로 적어 두었다")
      .not.toMatch(/\d+\s*(가지|개|편)/u);
  });
});
