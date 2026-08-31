import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 한글 라벨에는 **양수 자간을 쓰지 않는다.**
 *
 * ## 왜
 *
 * 자간을 벌리는 것은 라틴 대문자 관용이다. 한글에 쓰면 음절 덩어리가 흩어져 오히려
 * 읽기 어려워지고, 작은 글씨일수록 심하다. 정본 시안(`docs/landing/NotebookBest.html`)
 * 에는 양수 자간이 하나도 없다 — 음수 하나(`-0.035em`, 큰 제목용)뿐이다.
 *
 * 2026-08-31 운영 실측: 10px 한글 라벨이 자간 때문에 **19~22% 더 벌어져** 있었다
 * ("진행 상태" 37px → 44px, "답을 찾은 다음" 57px → 70px). 사용자 화면 76곳이 그랬다.
 *
 * ## 이 테스트가 지키는 것
 *
 * 요소의 **자기 텍스트**가 한글만인데 양수 자간 유틸리티를 달고 있으면 실패한다.
 *
 * 건드리지 않는 것: 라틴 대문자 라벨(거기서는 자간이 제 일을 한다), 관리자 화면,
 * 한글·라틴이 섞인 요소, 음수 자간(큰 제목용).
 *
 * ## 왜 CSS 도 보는가
 *
 * 처음 스윕은 JSX 만 훑었다. 그런데 같은 날 아침에 만든 `hb-h-eyebrow` 단이
 * `globals.css` 안에 `letter-spacing: 0.14em` 을 갖고 있었고, **그 단을 쓰는 두 곳이
 * 둘 다 한글 라벨**이었다. 자간이 JSX 에서 CSS 로 옮겨간 뒤라 스윕이 구조적으로 닿을
 * 수 없었다. 적대적 검토가 잡았다. 그래서 이 테스트는 CSS 쪽 단도 함께 본다.
 */

const WEB_ROOT = process.cwd();
const SRC = path.join(WEB_ROOT, "src");

/** 관리자 화면은 대상이 아니다 — 내부 도구이고 조밀한 표가 자간에 기대고 있다. */
function isAdmin(file: string): boolean {
  const rel = file.split(path.sep).join("/");
  return rel.includes("/app/(admin)") || rel.includes("/components/admin/");
}

/**
 * 여는 태그와 그 뒤 자기 텍스트(다음 `<` 까지).
 *
 * ⚠️ 처음엔 `className="…tracking-…"` 인 것만 골랐는데, 그러면 정리가 끝난 뒤
 * **분모가 0 이 되어 측정기 자기검증이 무너진다.** className 이 있는 요소를 전부
 * 세고 자간은 그 안에서 찾는다.
 */
const ELEMENT = /<(\w+)([^>]*?className="([^"]*?)"[^>]*?)>([^<]{0,90})/gs;

/** 양수 자간만. 음수(`tracking-[-0.03em]`)는 큰 제목용이라 대상이 아니다. */
const POSITIVE_TRACKING =
  /(?<![\w:./-])(?:[a-z0-9-]+:)*tracking-(?:\[[^\]-][^\]]*\]|wide|wider|widest)(?![\w./-])/;

/**
 * 화면에 나오는 글이 한글뿐인가.
 *
 * ⚠️ 처음엔 텍스트 전체에 라틴 글자가 있으면 "혼용" 으로 보고 건너뛰었다. 그런데
 * `{preview ? "관리자 검수용…" : "한국소비자원 참가격 공시"}` 처럼 **삼항 조건의
 * 식별자**(`preview`)가 라틴이라, 양쪽 갈래가 모두 한글인데도 걸러졌다. 실제로
 * 그 자리가 스윕에서 빠졌고 적대적 검토가 잡았다.
 *
 * 그래서 코드가 아니라 **따옴표 안 문자열**만 본다. 문자열이 하나도 없으면 화면에
 * 나올 글을 알 수 없으므로 판단을 보류한다(변수만 있는 요소와 같다).
 */
function isKoreanOnly(own: string): boolean {
  const literals = [...own.matchAll(/"([^"]*)"|'([^']*)'/g)]
    .map((m) => m[1] ?? m[2] ?? "")
    .filter(Boolean);
  const texts = literals.length > 0 ? literals : (own.includes("{") ? [] : [own]);
  if (texts.length === 0) return false;
  return texts.some((t) => /[가-힣]/.test(t)) && texts.every((t) => !/[A-Za-z]/.test(t));
}

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (full.endsWith(".tsx") && !full.includes(".test.")) out.push(full);
  }
  return out;
}

type Hit = { file: string; text: string; cls: string };

function scan(): { hits: Hit[]; checked: number } {
  const hits: Hit[] = [];
  let checked = 0;
  for (const file of collect(SRC)) {
    if (isAdmin(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(ELEMENT)) {
      const own = (m[4] ?? "").trim();
      if (!own) continue;                       // 텍스트가 없으면 판단 보류
      if (!isKoreanOnly(own)) continue;
      checked += 1;
      if (POSITIVE_TRACKING.test(m[3])) {
        hits.push({
          file: file.split(path.sep).join("/").replace(`${WEB_ROOT.split(path.sep).join("/")}/`, ""),
          text: own.slice(0, 20),
          cls: (m[3].match(POSITIVE_TRACKING) ?? [""])[0],
        });
      }
    }
  }
  return { hits, checked };
}

describe("한글 라벨의 자간", () => {
  it("측정기가 살아 있다", () => {
    const { checked } = scan();
    // 스캔이 비면 "위반 0건" 이 되어 공짜로 통과한다.
    expect(checked, "한글 전용 요소를 하나도 못 찾았다 — 스캔이 깨졌다").toBeGreaterThan(200);

    const sample = '<p className="text-xs font-bold tracking-[0.13em] text-black">한국소비자원 참가격</p>';
    expect(POSITIVE_TRACKING.test('text-xs tracking-[0.13em]'), "양수 자간을 못 잡는다").toBe(true);
    expect(POSITIVE_TRACKING.test('text-xs tracking-[-0.03em]'), "음수 자간을 잘못 잡는다").toBe(false);
    expect(POSITIVE_TRACKING.test('text-xs tracking-normal'), "normal 을 잘못 잡는다").toBe(false);
    expect([...sample.matchAll(ELEMENT)].length, "요소 정규식이 깨졌다").toBe(1);
  });

  it("한글 텍스트에 양수 자간이 없다", () => {
    const { hits } = scan();
    const lines = hits.map((h) => `${h.file} — "${h.text}" — ${h.cls}`);
    expect(
      lines,
      `한글 라벨 ${hits.length}곳에 라틴식 자간이 붙어 있습니다. `
        + `한글은 자간을 벌리면 음절 덩어리가 흩어져 읽기 나빠집니다.`,
    ).toEqual([]);
  });

  it("CSS 의 눈썹 단도 한글 기준을 따른다", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    const block = css.slice(css.indexOf('[class~="hb-h-eyebrow"]'));
    const decl = block.slice(0, block.indexOf("}"));

    // 이 단을 쓰는 곳이 전부 한글인 동안에는 자간이 0 이어야 한다.
    // JSX 만 훑는 스윕은 이 값을 구조적으로 못 본다 — 그래서 여기서 본다.
    const spacing = decl.match(/letter-spacing:\s*([^;!]+)/);
    expect(spacing, "hb-h-eyebrow 단에서 letter-spacing 선언을 못 찾았다").toBeTruthy();
    expect(spacing?.[1].trim(), "한글 눈썹에 양수 자간을 되살리지 마라").toBe("0");
  });
});
