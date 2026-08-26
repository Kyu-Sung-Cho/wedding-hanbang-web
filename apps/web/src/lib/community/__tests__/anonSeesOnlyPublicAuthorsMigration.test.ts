import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 로그아웃하면 커뮤니티 회원 명부가 통째로 열렸다.
 *
 * ## 운영 실측 (2026-08-26, 공개 anon 키)
 *
 *     GET /rest/v1/community_public_profiles?select=user_id,nickname
 *       적용 전  HTTP 200  content-range: 0-41/42
 *       적용 후  HTTP 200  content-range: 0-14/15
 *
 * 42명 중 **글도 댓글도 쓴 적 없는 27명(64%)** 의 닉네임·아바타·user_id 가
 * 브라우저 번들에 들어 있는 공개 키로 열거됐다. 원인은 뷰의 WHERE 첫 항이
 * `auth.uid() IS NULL OR …` 이라 로그아웃이면 **뒤를 보지 않고 통과**한 것이다.
 * 이 뷰는 `security_invoker` 가 아니라 소유자 권한으로 돌기 때문에 밑에 깔린
 * `community_profiles` 의 RLS 도 타지 않는다 — WHERE 절이 접근 통제의 전부였다.
 *
 * ## 좁히면서 무엇을 지켰나
 *
 * 익명 화면에서 이름이 비면 안 된다. 적용 후 운영에서 직접 쟀다:
 *
 *     익명이 받는 글 17건 · 댓글 18건
 *     이름이 필요한 작성자 15명 · 뷰가 주는 프로필 15명
 *     이름을 못 찾는 작성자 0명
 *
 * 로그인 경로는 한 글자도 안 건드렸다. 같은 시점 운영 측정:
 *
 *     total=42  authed=42  anon=15
 *
 * `authed` 가 42 로 남은 것이 중요하다. CASE 를 잘못 써서 익명 갈래가 로그인
 * 사용자에게까지 새면 그 값이 15 로 떨어진다.
 *
 * ## 왜 소스를 읽는 검사인가
 *
 * 이 저장소에 운영 DB 를 상대로 도는 테스트는 없다. 그래서 **모양**을 잠근다 —
 * 특히 누가 "익명이 아무것도 못 본다"며 EXISTS 를 지우고 옛 단락평가로 되돌리는
 * 것을 막는다. 주석은 세지 않는다. 예전에 주석 속 문구를 위반으로 세어
 * 엉뚱한 곳에서 실패한 적이 있다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const MIGRATION = "20260826120000_anon_sees_only_public_authors.sql";

const raw = readFileSync(join(REPO_ROOT, "supabase", "migrations", MIGRATION), "utf8");

/** `--` 주석을 뺀 실행되는 SQL 만. */
const sql = raw
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** 공백을 지워 줄바꿈·들여쓰기에 걸리지 않게 한다. */
const dense = sql.replace(/\s+/gu, "");

/**
 * `CASE WHEN auth.uid() IS NULL THEN …` 과 `ELSE` 사이, 즉 **로그아웃일 때만 도는
 * 조건식**. 문자열을 찾는 대신 이 갈래를 통째로 꺼내서 본다 — 그러지 않으면
 * `THEN TRUE OR EXISTS(…)` 처럼 옛 동작을 되살리면서 검사만 비껴가는 모양을 놓친다.
 */
const ANON_BRANCH_START = "WHENauth.uid()ISNULLTHEN";
const anonBranch = (() => {
  const from = dense.indexOf(ANON_BRANCH_START);
  if (from < 0) return "";
  const body = dense.slice(from + ANON_BRANCH_START.length);
  const to = body.indexOf("ELSE");
  return to < 0 ? body : body.slice(0, to);
})();

describe("측정기가 살아 있다", () => {
  it("마이그레이션을 실제로 읽는다", () => {
    expect(raw.length).toBeGreaterThan(500);
    expect(sql.length, "주석을 다 걷어내니 SQL 이 남지 않았다").toBeGreaterThan(300);
  });

  it("주석은 세지 않는다", () => {
    expect(sql).not.toContain("무엇이 있었나");
    expect(raw).toContain("무엇이 있었나");
  });
});

describe("로그아웃 갈래가 공개 작성자로 좁혀져 있다", () => {
  it("익명이면 EXISTS 로 공개 글 작성자인지 본다", () => {
    expect(dense).toContain(ANON_BRANCH_START);
    expect(anonBranch).toMatch(/EXISTS\(SELECT1FROMpublic\.community_posts/u);
  });

  it("익명 갈래의 EXISTS 가 하나도 빠짐없이 공개 글로 한정한다", () => {
    // 처음엔 `dense` 에 `p.visibility='public'` 이 **한 번이라도** 있으면 통과였다.
    // 그래서 게시글 쪽 한정만 지우는 변형을 놓쳤다 — 댓글 쪽 문자열이 남아 있으니까.
    // 개수를 맞춰 본다: EXISTS 마다 한정이 하나씩 있어야 한다.
    const exists = anonBranch.match(/EXISTS\(/gu) ?? [];
    const scoped = anonBranch.match(/p\.visibility='public'/gu) ?? [];

    expect(exists.length, "익명 갈래에 EXISTS 가 둘(글·댓글) 있어야 한다").toBe(2);
    expect(scoped.length, `EXISTS ${exists.length}개 중 ${scoped.length}개만 공개 글로 한정한다`)
      .toBe(exists.length);
  });

  it("공개 글에 달린 댓글의 작성자도 본다 — 툼스톤 자리가 비지 않게", () => {
    expect(dense).toMatch(/EXISTS\(SELECT1FROMpublic\.community_comments/u);
    expect(dense).toContain("JOINpublic.community_postspONp.id=c.post_id");
  });

  it("익명 갈래에 무조건 참인 항이 없다", () => {
    // 처음엔 `auth.uid()ISNULLOR` 만 막았다가 **변형 검사에 뚫렸다** —
    // `WHEN auth.uid() IS NULL THEN TRUE OR EXISTS(…)` 는 그 정규식을 비껴가면서
    // 옛 동작을 정확히 되살린다. 문자열을 찾지 말고 **갈래 자체를 꺼내** 본다.
    expect(anonBranch.length, "익명 갈래를 못 꺼냈다").toBeGreaterThan(20);
    expect(anonBranch.startsWith("EXISTS("), `익명 갈래가 EXISTS 로 시작하지 않는다: ${anonBranch.slice(0, 40)}`)
      .toBe(true);
    // 이 갈래는 EXISTS 를 OR 로 이은 것뿐이어야 한다. 상수 항이 하나라도 끼면
    // 나머지를 아무리 잘 써도 전부 통과한다.
    expect(anonBranch, "무조건 참인 항이 끼어 있다").not.toMatch(/(^|OR|\()TRUE\b/u);
    expect(anonBranch).not.toMatch(/auth\.uid\(\)ISNULLOR/u);
  });
});

describe("로그인 갈래는 그대로다", () => {
  it("차단 관계 검사가 남아 있다", () => {
    expect(dense).toContain("community_private.viewer_can_see_current_user");
  });

  it("본인은 언제나 자기를 본다", () => {
    expect(dense).toContain("profile.user_id=auth.uid()");
  });

  it("정지·비활성 검사는 두 갈래 모두에 걸린다 — CASE 바깥에 있다", () => {
    const caseAt = dense.indexOf("ANDCASE");
    expect(caseAt, "CASE 를 못 찾았다").toBeGreaterThan(0);
    const beforeCase = dense.slice(0, caseAt);
    expect(beforeCase).toContain("public.community_runtime_mode()<>'disabled'");
    expect(beforeCase).toContain("COALESCE(profile.is_suspended,false)=false");
  });
});

describe("뷰의 계약이 유지된다", () => {
  it("security_barrier 를 잃지 않는다 — 잃으면 통제가 뚫린다", () => {
    expect(dense).toContain("WITH(security_barrier=true)");
  });

  it("컬럼 다섯 개를 순서대로 그대로 준다 — CREATE OR REPLACE 는 바꾸면 실패한다", () => {
    const cols = ["user_id", "nickname", "avatar_url", "badge", "rank"];
    const select = dense.slice(dense.indexOf("SELECT"), dense.indexOf("FROMpublic.community_profiles"));
    let cursor = -1;
    for (const col of cols) {
      const at = select.indexOf(`profile.${col}`);
      expect(at, `${col} 이 없다`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});

describe("릴리스 매니페스트에 등록돼 있다", () => {
  it("등록하지 않으면 프로덕션 빌드가 통째로 죽는다", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "supabase", "release-manifests", "vendor-disclosure-v2-20260718.json"),
        "utf8",
      ),
    ) as { expandMigrations: Array<{ file: string; sha256: string }> };

    const entry = manifest.expandMigrations.find((e) => e.file === MIGRATION);
    expect(entry, "매니페스트에 없다").toBeDefined();
    expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("기록된 sha256 이 실제 파일과 같다", () => {
    // 파일을 고치고 매니페스트를 안 고치면 값이 어긋난다. 그 상태는 로컬·CI·Preview
    // 를 전부 통과하고 **프로덕션 빌드에서만** 죽는데, 직전 배포가 계속 서비스되기
    // 때문에 며칠 뒤에야 안다.
    const manifest = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "supabase", "release-manifests", "vendor-disclosure-v2-20260718.json"),
        "utf8",
      ),
    ) as { expandMigrations: Array<{ file: string; sha256: string }> };

    const recorded = manifest.expandMigrations.find((e) => e.file === MIGRATION)!.sha256;
    const actual = createHash("sha256").update(raw.replace(/\r\n?/gu, "\n"), "utf8").digest("hex");

    expect(actual, `매니페스트의 sha256 을 ${actual} 로 바꾸세요`).toBe(recorded);
  });
});
