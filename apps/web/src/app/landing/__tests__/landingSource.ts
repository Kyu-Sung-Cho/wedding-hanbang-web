import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 랜딩 소스를 읽는 공용 도구.
 *
 * ## 왜 생겼나
 *
 * 랜딩 테스트 6개 파일이 각자 `withoutComments` 를 복사해 갖고 있었고,
 * **여섯 벌이 전부 같은 버그**였다. 줄 **처음**에 오는 `//` 만 지워서:
 *
 * - `body: "…보여드려요.", // 웨딩한방은 둘이 어디서 갈리는지부터 봅니다.`
 *   → 화면에서 지운 문장이 줄 끝 주석으로 남아 있으면 "있다"고 통과했다.
 * - `{/* <PrivateLaneSection /> *␣/}`
 *   → 섹션을 통째로 꺼도 순서 검사가 렌더된 것으로 세어 세 단언이 빈 통과했다.
 * - 주석에 `<h2>{scenes.title}</h2>` 한 줄
 *   → 진짜 헤드라인이 정본과 어긋나도 헤드라인 대조가 통과했다.
 *
 * 2026-08-27 적대적 검증에서 심은 변형 215개 중 이 갈래로만 8개가 빠져나갔다.
 *
 * ## 왜 정규식이 아닌가
 *
 * `//` 를 아무 데서나 지우면 `href: "https://hanbang.ai"` 의 `//` 도 지워진다.
 * 옛 구현이 줄 처음만 본 이유가 그것이었다. 그래서 문자열·템플릿 리터럴을 아는
 * 작은 스캐너를 쓴다 — 정규식으로는 이 둘을 동시에 만족시킬 수 없다.
 *
 * **이 파일의 동작은 `landingSource.test.ts` 가 실제 우회 시도로 검사한다.**
 * 여기를 고치면 그쪽을 먼저 돌려라.
 */

export const APP_ROOT = resolve(process.cwd());
export const REDESIGN_DIR = resolve(APP_ROOT, "src/components/landing/redesign");
export const CONTENT_PATH = "src/components/landing/redesign/landingContent.ts";

/** 원문 그대로. 주석까지 본다 — 주석 자체를 검사할 때만 쓴다. */
export function source(relativePath: string): string {
  return readFileSync(resolve(APP_ROOT, relativePath), "utf8");
}

/**
 * 주석을 벗긴 소스.
 *
 * 문자열(`'` `"`)과 템플릿 리터럴(`` ` ``) 안의 `//` 는 건드리지 않는다.
 *
 * ⚠️ **정규식 리터럴은 처리하지 않는다.** `/https?:\/\//` 처럼 `//` 를 담은 정규식이
 * 랜딩 소스에 생기면 그 뒤 줄이 주석으로 잘린다. 지금은 그런 정규식이 0건이라
 * 문제되지 않는다(2026-08-27 실측). 필요해지면 스캐너에 정규식 갈래를 더해야 하는데,
 * 나눗셈과 정규식 시작을 구분하려면 앞 토큰을 봐야 해서 간단하지 않다.
 * 그때까지는 **랜딩 소스에 `//` 를 담은 정규식을 쓰지 마라.**
 * JSX 주석 `{/* … *␣/}` 은 블록 주석을 지운 뒤 남는 `{}` 를 함께 걷는다.
 */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];

    // 문자열·템플릿 리터럴은 통째로 넘긴다
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // 줄 주석 — 줄 처음이든 줄 끝이든
    if (c === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }

    // 블록 주석
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  // 블록 주석이 사라지고 남은 JSX 껍데기 `{  }` 를 걷는다.
  // 이걸 안 하면 `{/* <Foo /> */}` 가 `{}` 로 남아 컴포넌트 목록에는 안 잡히지만
  // 빈 표현식이 코드처럼 보인다.
  return out.replace(/\{\s*\}/gu, "");
}

/** 주석을 벗긴 파일 내용. 화면에 나가는 것만 보고 싶을 때 쓴다. */
export function rendered(relativePath: string): string {
  return stripComments(source(relativePath));
}

/** 랜딩이 실제로 갖고 있는 컴포넌트 파일 이름 전부(테스트 파일 제외). */
export function landingComponentFiles(): string[] {
  return readdirSync(REDESIGN_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .sort();
}

/**
 * 랜딩 컴포넌트 전부의 `[파일명, 주석 벗긴 소스]`.
 *
 * 목록을 손으로 적지 않는다 — 손으로 적은 목록은 새로 생긴 파일을 놓치고,
 * 실제로 그렇게 놓친 적이 있다.
 */
export function everyLandingComponent(): Array<[string, string]> {
  return landingComponentFiles().map((file) => [
    file,
    stripComments(readFileSync(resolve(REDESIGN_DIR, file), "utf8")),
  ]);
}

/**
 * `landingContent.ts` 에서 한 블록만 잘라낸다.
 *
 * **경계를 못 찾으면 던진다.** `slice(a, b)` 는 인덱스가 -1 이어도 조용히 뭔가를
 * 돌려주고, `slice(-1)` 은 마지막 한 글자를 준다 — 그래서 `length > 0` 으로 지키던
 * 가드는 경계가 사라져도 한 번도 울지 않았다(2026-08-27 변형으로 확인).
 *
 * @param key   블록 이름. `landingContent` 안의 키(`closing`)거나 최상위
 *              export 이름(`availableNow`)이다.
 * @param until 다음 블록 이름. 생략하면 파일 끝까지.
 */
export function contentBlock(key: string, until?: string): string {
  const text = rendered(CONTENT_PATH);
  const startPatterns = [`  ${key}: {`, `export const ${key} = `];
  const start = startPatterns
    .map((p) => text.indexOf(p))
    .find((idx) => idx >= 0);
  if (start === undefined) {
    throw new Error(
      `landingContent.ts 에서 "${key}" 블록을 찾지 못했습니다. ` +
        `이름이 바뀌었다면 이 검사도 같이 옮겨야 합니다.`,
    );
  }

  if (!until) return text.slice(start);

  const endPatterns = [`  ${until}: {`, `export const ${until} = `];
  const end = endPatterns.map((p) => text.indexOf(p, start)).find((idx) => idx >= 0);
  if (end === undefined) {
    throw new Error(
      `landingContent.ts 에서 "${key}" 다음 경계 "${until}" 을 찾지 못했습니다. ` +
        `경계가 사라지면 이 블록이 파일 끝까지 넓어져 검사가 조용히 무의미해집니다.`,
    );
  }
  return text.slice(start, end);
}

/**
 * `app/landing/page.tsx` 가 **실제로 렌더하는** 컴포넌트를 순서대로.
 *
 * 주석을 벗긴 뒤 센다. 안 벗기면 `{/* <PrivateLaneSection /> *␣/}` 처럼 꺼 놓은
 * 섹션이 렌더된 것으로 잡혀, 섹션을 통째로 꺼도 순서 검사가 통과한다.
 */
export function renderedSections(): string[] {
  const page = rendered("src/app/landing/page.tsx");
  const main = page.slice(page.indexOf("<main"), page.indexOf("</main>"));
  if (main.length <= 0) {
    throw new Error("landing/page.tsx 에서 <main> 을 찾지 못했습니다.");
  }
  return [...main.matchAll(/<([A-Z][A-Za-z0-9]*)\s*\/>/gu)].map((m) => m[1]);
}
