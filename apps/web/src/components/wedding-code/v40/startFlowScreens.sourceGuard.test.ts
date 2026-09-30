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

/**
 * 코드가 만지면 안 되는 브라우저 기능(네트워크, 브라우저 저장소, 주소, 이용 통계, 라우터, 날 HTML).
 * 아래 자체 확인이 패턴마다 실제로 위반 조각을 잡는지 본다(정규식이 고장 나 아무것도 못 잡는 가드를 막는다).
 */
const FORBIDDEN_API_PATTERNS: readonly RegExp[] = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /sendBeacon/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\baxios\b|@supabase\/|lib\/supabase/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /document\.cookie/,
  /window\.location/,
  /\b(?:document|globalThis|self|top|parent)\.location\b/,
  /\blocation\.(href|hash|search|assign|replace|reload)/,
  /(?<![.\w])location\.[A-Za-z]/,
  /history\.(pushState|replaceState)/,
  /\bhistory\.(?:back|forward|go)\b/,
  /captureWeddingCodeEvent/,
  /lib\/analytics/,
  /next\/navigation/,
  /useRouter/,
  /dangerouslySetInnerHTML/,
];

/** 위 패턴이 잡아야 하는 위반 조각. 패턴마다 하나 이상이 걸려야 하고, 조각마다 하나 이상의 패턴이 잡아야 한다. */
const FORBIDDEN_API_SAMPLES: readonly string[] = [
  'void fetch("/api/x");',
  "const request = new XMLHttpRequest();",
  'navigator.sendBeacon("/x", data);',
  'const socket = new WebSocket("wss://x.test");',
  'const stream = new EventSource("/x");',
  'import axios from "axios";',
  'import { createClient } from "@supabase/supabase-js";',
  'import { client } from "@/lib/supabase/client";',
  'window.localStorage.setItem("a", "b");',
  'sessionStorage.getItem("a");',
  'indexedDB.open("x");',
  'document.cookie = "a=b";',
  "window.location.reload();",
  'document.location.assign("/x");',
  'globalThis.location = "/x";',
  'location.hash = "#x";',
  "const path = location.pathname;",
  'history.pushState(null, "", "/x");',
  'history.replaceState(null, "", "/x");',
  "history.back();",
  'captureWeddingCodeEvent("wedding_code_x");',
  'import { track } from "@/lib/analytics";',
  'import { usePathname } from "next/navigation";',
  "const router = useRouter();",
  "<p dangerouslySetInnerHTML={{ __html: text }} />",
];

/**
 * 코드가 가져오는 모듈 경로를 모두 뽑는다. from 절, 부수효과 import, 동적 import, require, export from 을 따옴표 종류와 줄바꿈에 상관없이 읽는다.
 * (예전 가드는 큰따옴표 절대 경로의 from 한 형태만 봐서 작은따옴표, 상대 경로, 동적 import 로 가져오면 지나쳤다.)
 */
export function moduleSpecifiers(code: string): string[] {
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*(["'`])([^"'`\n]+)\1/g,
    /\bimport\s*(["'`])([^"'`\n]+)\1/g,
    /\bimport\s*\(\s*(["'`])([^"'`\n]+)\1/g,
    /\brequire\s*\(\s*(["'`])([^"'`\n]+)\1/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[2]);
  }
  return found;
}

/** 이 화면들이 가져오면 안 되는 모듈이면 까닭을, 아니면 null. v3.1 은 동결이고, 저장소와 링크 코덱은 클라이언트만 다룬다. */
export function forbiddenImportReason(specifier: string): string | null {
  if (/v31/i.test(specifier)) return "동결된 v3.1 파일";
  if (/(^|\/)v40\/(storage|codec)(\.[cm]?[jt]sx?)?$/.test(specifier)) return "저장소 모듈";
  return null;
}

describe("시작과 질문 흐름 화면 소스 위생", () => {
  it.each(FILES)("%s: 유니코드 이스케이프, 캐리지 리턴, 줄표가 없다", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    // 중괄호 꼴(\u{AC00})과 숫자 문자 참조(&#xAC00;)도 한글을 소스에서 숨기는 이스케이프다.
    expect(source).not.toMatch(/\\u\{[0-9a-fA-F]+\}/);
    expect(source).not.toMatch(/&#[xX]?[0-9a-fA-F]+;/);
    expect(source).not.toContain("\r");
    expect(source).not.toMatch(/[–—]/);
    expect(source).not.toMatch(/[‐-―−]/u);
  });

  it.each(FILES)("%s: 코드에 한글 문구가 없다(문구는 모두 copy.ts 에서 온다)", (file) => {
    const code = stripComments(read(file));
    expect(code.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]+/g) ?? []).toEqual([]);
  });

  it.each(FILES)("%s: 네트워크, 브라우저 저장소, 주소, 통계, 라우터를 만지지 않는다", (file) => {
    const code = stripComments(read(file));
    for (const pattern of FORBIDDEN_API_PATTERNS) {
      expect(code, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("금지 패턴이 모두 살아 있다: 패턴마다 위반 조각을 잡고, 조각마다 잡는 패턴이 있다(가드가 헛돌지 않는다)", () => {
    for (const pattern of FORBIDDEN_API_PATTERNS) {
      expect(FORBIDDEN_API_SAMPLES.some((sample) => pattern.test(sample)), `아무 조각도 못 잡는 패턴 ${pattern}`).toBe(true);
    }
    for (const sample of FORBIDDEN_API_SAMPLES) {
      expect(FORBIDDEN_API_PATTERNS.some((pattern) => pattern.test(sample)), `아무 패턴도 못 잡는 조각 ${sample}`).toBe(true);
      // 주석 걷기를 거쳐도 조각이 살아남아야 한다(주석 걷개가 위반을 대신 지우는 일을 막는다).
      expect(FORBIDDEN_API_PATTERNS.some((pattern) => pattern.test(stripComments(sample))), `주석 걷기가 지운 조각 ${sample}`).toBe(true);
    }
  });

  it.each(FILES)("%s: 동결된 v3.1 파일과 저장소 모듈을 가져오지 않는다", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/WeddingCodeV31|weddingCode\/v31|weddingCodeV31|constants\/weddingCodeV31/);
    expect(code).not.toMatch(/from\s+"@\/lib\/weddingCode\/v40\/(storage|codec)"/);
    // 위 두 줄은 큰따옴표 절대 경로의 from 절만 본다. 가져오는 경로를 모두 뽑아 형태와 상관없이 다시 본다.
    for (const specifier of moduleSpecifiers(code)) {
      expect(forbiddenImportReason(specifier), `${file} 가 가져온 ${specifier}`).toBeNull();
    }
  });

  it.each(FILES)("%s: 가져오기 경로를 읽어 낸다(가드가 헛돌지 않는다)", (file) => {
    expect(moduleSpecifiers(stripComments(read(file))).length).toBeGreaterThan(0);
  });

  it("가져오기 경로 도구가 여러 형태를 읽고 금지 경로를 알아본다(가드가 헛돌지 않는다)", () => {
    const sample = [
      'import a from "@/x/a";',
      "import { b } from '../../y/b';",
      'import "./side";',
      'export { c } from "./c";',
      'const d = await import("@/lib/d");',
      "const e = require('e');",
      "import {\n  f,\n} from `./f`;",
    ].join("\n");
    expect([...moduleSpecifiers(sample)].sort()).toEqual(["../../y/b", "./c", "./f", "./side", "@/lib/d", "@/x/a", "e"]);
    for (const forbidden of [
      "@/app/wedding-code/useV31LocalProgress",
      "@/app/wedding-code/WeddingCodeV31Results",
      "@/lib/weddingCode/v31Flow",
      "@/constants/weddingCodeV31",
      "@/lib/weddingCode/v40/storage",
      "@/lib/weddingCode/v40/codec",
      "../../../lib/weddingCode/v40/storage",
      "@/lib/weddingCode/v40/storage.ts",
    ]) {
      expect(forbiddenImportReason(forbidden), forbidden).not.toBeNull();
    }
    for (const allowed of ["@/lib/weddingCode/v40/copy", "@/lib/weddingCode/v40/types", "./styles", "react", "@/components/ui/Button"]) {
      expect(forbiddenImportReason(allowed), allowed).toBeNull();
    }
  });

  it("주석을 걷어내는 도구가 문자열 안의 한글은 남긴다(가드가 헛돌지 않는다)", () => {
    const sample = ['const a = "가나";', "// 주석 한글", "/* 블록 한글 */", 'const b = "x"; // 뒤 주석 한글'].join("\n");
    expect(stripComments(sample).match(/[가-힣]+/g)).toEqual(["가나"]);
    // 두 블록 주석 사이의 코드는 남아야 한다(주석 걷개가 첫 주석에서 마지막 주석까지 통째로 지우면 그 사이의 위반이 모두 숨는다).
    const between = ["/* 첫 주석 */", 'const kept = "다라";', "/* 둘째 주석 */", 'const also = "마바";'].join("\n");
    expect(stripComments(between).match(/[가-힣]+/g)).toEqual(["다라", "마바"]);
  });
});
