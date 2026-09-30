import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 시작과 질문 흐름 화면(IntroScreen, PreviousVersionCard, SectionCard, RestCard, SelfIntroCard, ProgressBar, QuestionScreen, ReceiverScreen,
 * NoticeScreens와 그 도우미)의 소스 위생.
 *
 * 이 화면들은 문구를 모두 lib/weddingCode/v40/copy.ts 에서 가져온다. 코드(주석 밖)에 한글이 하나라도 있으면 문구가 copy.ts 밖에 있다는 뜻이다.
 * 또 화면은 데이터와 콜백만 받는다: 네트워크 요청, 브라우저 저장소, 주소, 이용 통계, 라우터를 만지지 않는다(링크 전용 계약).
 * v3.1 파일은 동결이라 가져오지 않는다.
 */

const dir = __dirname;
const FILES = [
  "SectionCard.tsx",
  "useScreenFocus.ts",
  "ProgressBar.tsx",
  "NoticeScreens.tsx",
  "PreviousVersionCard.tsx",
  "IntroScreen.tsx",
  "RestCard.tsx",
  "SelfIntroCard.tsx",
  "QuestionScreen.tsx",
  "ReceiverScreen.tsx",
] as const;

function read(file: string): string {
  return readFileSync(path.join(dir, file), "utf8");
}

/**
 * 블록 주석과 줄 주석을 걷어낸다. 문자열 안의 // 는 이 파일들에 없다(주소는 "/privacy" 하나뿐이다).
 * 줄 주석은 줄 앞머리이거나 코드 뒤 공백 다음에 오는 // 만 본다.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("시작과 질문 흐름 화면 소스 위생", () => {
  it.each(FILES)("%s: 유니코드 이스케이프, 캐리지 리턴, 줄표가 없다", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(source).not.toContain("\r");
    expect(source).not.toMatch(/[–—]/);
  });

  it.each(FILES)("%s: 코드에 한글 문구가 없다(문구는 모두 copy.ts 에서 온다)", (file) => {
    const code = stripComments(read(file));
    expect(code.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]+/g) ?? []).toEqual([]);
  });

  it.each(FILES)("%s: 네트워크, 브라우저 저장소, 주소, 통계, 라우터를 만지지 않는다", (file) => {
    const code = stripComments(read(file));
    for (const pattern of [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /sendBeacon/,
      /\bWebSocket\b/,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /document\.cookie/,
      /window\.location/,
      /\blocation\.(href|hash|search|assign|replace|reload)/,
      /history\.(pushState|replaceState)/,
      /captureWeddingCodeEvent/,
      /lib\/analytics/,
      /next\/navigation/,
      /useRouter/,
      /dangerouslySetInnerHTML/,
    ]) {
      expect(code, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(FILES)("%s: 동결된 v3.1 파일과 저장소 모듈을 가져오지 않는다", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/WeddingCodeV31|weddingCode\/v31|weddingCodeV31|constants\/weddingCodeV31/);
    expect(code).not.toMatch(/from\s+"@\/lib\/weddingCode\/v40\/(storage|codec)"/);
  });

  it("주석을 걷어내는 도구가 문자열 안의 한글은 남긴다(가드가 헛돌지 않는다)", () => {
    const sample = ['const a = "가나";', "// 주석 한글", "/* 블록 한글 */", 'const b = "x"; // 뒤 주석 한글'].join("\n");
    expect(stripComments(sample).match(/[가-힣]+/g)).toEqual(["가나"]);
  });
});
