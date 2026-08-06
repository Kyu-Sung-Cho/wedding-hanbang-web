import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `.select("...")`의 컬럼 이름은 **아무도 검사하지 않는다.**
//
// `apps/web/src/types/database.types.ts`는 생성물이 아니라 수기로 쓴 295줄이고,
// Supabase 클라이언트는 그 타입에 묶여 있지 않다. 실제로 오늘 `profiles`에서
// `preparation_status`를 읽는 코드를 넣었는데 그 컬럼은 database.types.ts의
// Profile 인터페이스에 없다 — 그런데도 타입체크가 통과했다.
//
// 즉 컬럼 이름을 한 글자 틀리거나, 마이그레이션에서 컬럼을 지우고 코드를 안 고치면
// **런타임 500이 날 때까지 아무도 모른다.** 배포 순간에 깨지는 종류다.
//
// ## 왜 "마이그레이션 어디든 등장"이 기준인가
//
// 처음에는 CREATE TABLE 본문과 ADD COLUMN을 파싱해 정확한 스키마를 만들려 했다.
// 그랬더니 13개가 걸렸는데 전부 오탐이었다 — 중첩 select의 테이블 이름이거나,
// 파서가 놓친 CREATE TABLE 형식이었다(`summary_type`은 마이그레이션 1070행에 실제로
// 있었다). 정밀도를 높이려다 신뢰를 잃는 검사가 되느니, 느슨하게 잡고 오탐 0을
// 유지하는 편이 낫다.
//
// 이 기준으로 잡히는 것은 **마이그레이션 전체에 한 번도 나타나지 않는 이름** —
// 오타, 또는 지워진 컬럼이다. 그게 배포를 깨는 종류다.
//
// ## 못 보는 것
//
// - `select("*")`와 템플릿 문자열(`${}`)은 건너뛴다.
// - 컬럼이 **다른 테이블**에 있어도 통과한다. 테이블 단위 대조는 안 한다.
// - RPC 반환값의 필드는 보지 않는다.

const REPO_ROOT = resolve(process.cwd(), "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".expo") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

function scan() {
  const migrationsDir = join(REPO_ROOT, "supabase/migrations");
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n")
    .toLowerCase();

  const sourceFiles = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "packages/shared/src"]
    .flatMap((dir) => walk(join(REPO_ROOT, dir)))
    .filter((path) => !/__tests__|\.test\.|\.spec\./.test(path));

  const unknown = new Map<string, string>();
  let selectCalls = 0;
  let columnRefs = 0;

  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
      const body = match[2];
      if (body.includes("*") || body.includes("${")) continue;
      selectCalls += 1;

      // 중첩 관계 select(`profiles(name)`)의 괄호 안은 지우고 관계 이름만 남긴다.
      for (const raw of body.replace(/\([^()]*\)/g, "").split(",")) {
        let column = raw.trim();
        if (!column) continue;
        if (column.includes(":")) column = column.split(":").pop()!.trim(); // 별칭
        column = column.replace(/!.*$/, "").replace(/^.*\./, "").trim(); // 힌트·테이블 한정
        if (!/^[a-z_][a-z0-9_]*$/i.test(column)) continue;
        columnRefs += 1;
        if (!sql.includes(column.toLowerCase())) {
          const relative = path
            .slice(REPO_ROOT.length + 1)
            .split(String.fromCharCode(92))
            .join("/");
          if (!unknown.has(column)) unknown.set(column, relative);
        }
      }
    }
  }

  return { unknown, selectCalls, columnRefs };
}

describe("select 하는 컬럼은 스키마에 존재한다", () => {
  const { unknown, selectCalls, columnRefs } = scan();

  it("마이그레이션에 한 번도 없는 이름을 읽지 않는다", () => {
    // 실패하면 대개 오타이거나, 마이그레이션에서 지운 컬럼을 코드가 아직 읽는
    // 것이다. 둘 다 배포하는 순간 500이 난다. 타입은 이걸 잡지 못한다 —
    // database.types.ts는 수기 파일이고 select 문자열과 대조되지 않는다.
    expect(Object.fromEntries(unknown), "스키마에 없는 컬럼").toEqual({});
  });

  it("검사가 실제로 돌아간다", () => {
    // 정규식이 아무것도 못 잡으면 이 테스트는 영원히 통과한다. 오늘 스캐너가
    // 세 번 조용히 0건을 냈다.
    expect(selectCalls).toBeGreaterThan(200);
    expect(columnRefs).toBeGreaterThan(1_000);
  });
});
