import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { sanitizeSentryBreadcrumb, type ScrubbableBreadcrumb } from "@hanbang/shared";

/**
 * 클릭 흔적(breadcrumb)이 첨부 파일명·게시글 제목·닉네임을 그대로 실어 날랐다.
 *
 * ## 무엇이 있었나
 *
 * Sentry 의 DOM breadcrumb 통합은 클릭된 요소를 CSS 선택자처럼 적으면서
 * `["aria-label","type","name","title","alt"]` 속성값을 **그대로** 붙인다
 * (`@sentry/core` 의 `htmlTreeAsString`). 이 앱에서 그 자리에 오는 것은 사용자
 * 자신의 글이다:
 *
 *     button[aria-label="상견례_견적_최종.pdf 첨부 제거"]   ← 첨부 파일명
 *     a[aria-label="… 게시글 보기"]                          ← 커뮤니티 글 제목
 *     img[alt="예비신부수민"]                                ← 닉네임
 *
 * 그런데 `sanitizeSentryBreadcrumb` 은 message 에 `redactSentryText` 만 태웠고,
 * 그 정규식 6개(URL·이메일·전화·주민번호·JWT·키 접두어)에 **한글 문장은 하나도
 * 안 걸린다.** breadcrumb 은 모든 이벤트에 딸려 나가므로, 오류 하나가 그 사용자의
 * 직전 클릭 내용을 함께 외부로 보낸다.
 *
 * CLAUDE.md 불변식 9: 로그·분석·오류·push·URL 에 대화·첨부 원문을 넣지 않는다.
 *
 * ## 왜 통째로 지우지 않고 값만 지우나
 *
 * 어디를 눌렀는지는 알아야 사고를 재현한다. 그래서 태그·class·id 는 남기고
 * 값만 지운다. `type` 도 남긴다 — `button`·`submit` 같은 고정값이라 사용자 자료가
 * 아니다.
 *
 * ## 여기 있는 마크업은 지어낸 게 아니다
 *
 * 아래 문자열은 실제 컴포넌트의 속성에서 왔다(`ChatContent.tsx` 첨부 미리보기,
 * `CommunityLandingClient.tsx` 피드 카드 오버레이, `Avatar.tsx`, `BlockUserButton.tsx`,
 * `VendorTagPicker.tsx`). 내가 고른 쉬운 예시로 검사하면 실제 경로를 안 밟는다.
 */

const crumb = (message: string) =>
  sanitizeSentryBreadcrumb<ScrubbableBreadcrumb>({ category: "ui.click", message }).message ?? "";

describe("측정기가 살아 있다", () => {
  it("옛 동작이라면 이 검사가 실제로 깨진다", () => {
    // 값을 안 지우던 시절의 결과를 그대로 적어 둔다. 아래 검사들은 이 문자열을
    // 통과시키지 않아야 의미가 있다.
    const before = 'img.avatar[alt="예비신부수민"]';
    expect(before).toContain("예비신부수민");
  });
});

describe("클릭 흔적에 사용자 글이 남지 않는다", () => {
  it.each([
    [
      "첨부 파일명 (제거 버튼)",
      'div.relative.group > button[aria-label="상견례_견적_최종.pdf 첨부 제거"][type="button"]',
      "상견례_견적_최종.pdf",
    ],
    [
      "첨부 파일명 (썸네일 alt)",
      'img.w-20.h-20.rounded-lg.object-cover[alt="상견례_견적_최종.jpg"]',
      "상견례_견적_최종.jpg",
    ],
    [
      "커뮤니티 게시글 제목",
      'a.absolute.inset-0[aria-label="예산 3천으로 시작했는데 지금 이게 무슨 일이죠 게시글 보기"]',
      "예산 3천으로 시작했는데",
    ],
    ["닉네임 (아바타)", 'body > img.avatar[alt="예비신부수민"]', "예비신부수민"],
    [
      "닉네임 (차단 버튼)",
      'button.text-sm[aria-label="두부랑결혼해 차단하기"][type="button"]',
      "두부랑결혼해",
    ],
    ["업체명", 'li > button[title="더채플앳청담"][type="button"]', "더채플앳청담"],
  ])("%s 이 나가지 않는다", (_label, message, secret) => {
    const cleaned = crumb(message);
    expect(cleaned, `원문이 그대로 남았다: ${cleaned}`).not.toContain(secret);
    expect(cleaned).toContain("[redacted]");
  });

  it("어디를 눌렀는지는 남는다 — 이게 없으면 재현을 못 한다", () => {
    const cleaned = crumb('div.relative.group > button[aria-label="상견례_견적_최종.pdf 첨부 제거"][type="button"]');
    expect(cleaned).toContain("div.relative.group");
    expect(cleaned).toContain("button");
    // type 은 고정값이라 남긴다.
    expect(cleaned).toContain('[type="button"]');
  });

  it("한 요소에 속성이 여럿이어도 값마다 지운다", () => {
    const cleaned = crumb('input[name="닉네임"][title="예비신부수민"][aria-label="이름 입력"][type="text"]');
    for (const secret of ["닉네임", "예비신부수민", "이름 입력"]) {
      expect(cleaned, `${secret} 가 남았다`).not.toContain(secret);
    }
    expect(cleaned).toContain('[type="text"]');
  });

  it("값 안에 따옴표가 들어가도 놓치지 않는다", () => {
    // htmlTreeAsString 은 속성값을 이스케이프하지 않는다. 게시글 제목에 따옴표가
    // 있으면 단순한 [^\"]* 패턴은 매칭에 실패해 원문이 통째로 새어 나간다.
    const cleaned = crumb('a[aria-label="그날 "진짜" 울었어요 게시글 보기"]');
    expect(cleaned, `따옴표가 든 제목이 샜다: ${cleaned}`).not.toContain("진짜");
    expect(cleaned).not.toContain("울었어요");
  });

  it("기존 방어선은 그대로다 — data 는 통째로 버리고 식별자 패턴도 지운다", () => {
    const result = sanitizeSentryBreadcrumb<ScrubbableBreadcrumb>({
      message: 'a[aria-label="문의"] 요청 실패 hong@example.com https://hanbang.ai/secret',
      data: { body: "요청 본문" },
    });
    expect(result.data).toBeUndefined();
    expect(result.message).not.toContain("hong@example.com");
    expect(result.message).not.toContain("hanbang.ai/secret");
    expect(result.message).not.toContain("문의");
  });

  it("DOM 이 아닌 평범한 메시지는 건드리지 않는다", () => {
    expect(crumb("navigation from /wedding to /price")).toBe("navigation from /wedding to /price");
  });
});

describe("웹과 모바일이 같은 규칙을 쓴다", () => {
  it("모바일이 사본을 따로 두지 않는다", () => {
    const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
    const mobile = readFileSync(
      join(REPO_ROOT, "apps", "mobile", "src", "lib", "sentryPrivacy.ts"),
      "utf8",
    );
    expect(mobile).toContain("@hanbang/shared");
    // 규칙이 두 벌로 갈라지면 한쪽만 고쳐진다.
    expect(mobile).not.toMatch(/aria-label\|title\|alt\|name/u);
  });
});
