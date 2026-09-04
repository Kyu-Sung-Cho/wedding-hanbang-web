/**
 * 첫 인사 요청키는 DB 클레임 함수가 받는 모양이어야 한다.
 *
 * 2026-09-04 브라우저 실측: #303 이 인사 요청키를 `greeting:<user>:<couple>` 로 바꿨는데
 * 운영·스테이징의 `claim_amora_chat_request` 는 `greeting:<user>` **정확히 그 모양**만
 * 받는다(그 밖은 22023 AMORA_CHAT_CLAIM_INVALID_INPUT). 그래서 새 커플의 첫 화면이
 * "아모라를 불러오지 못했어요" 로 시작했다. 하네스는 인사를 요청하지 않아 하루 종일
 * 못 봤고, 브라우저로 새 커플을 열어서야 봤다.
 *
 * 여기서는 라우트의 키 템플릿과 저장소의 최신 마이그레이션 정의를 나란히 읽어
 * **둘이 같은 모양**인지 잰다. 어느 쪽을 바꾸든 다른 쪽을 함께 바꿔야 초록불이다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");

function latestMigrationDefining(needle: string): string {
  const dir = join(REPO_ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const hits = files.filter((name) => readFileSync(join(dir, name), "utf8").includes(needle));
  expect(hits.length, `no migration defines ${needle}`).toBeGreaterThan(0);
  return readFileSync(join(dir, hits[hits.length - 1]), "utf8");
}

describe("initial greeting request key", () => {
  const route = readFileSync(join(WEB_ROOT, "src", "app", "api", "chat", "route.ts"), "utf8");
  const routeKeyLine = route.match(/requestKind === "initial_greeting"\s*\n\s*\? `greeting:\$\{actorId\}([^`]*)`/u);

  it("라우트는 greeting:<actorId> 를 쓴다", () => {
    expect(routeKeyLine, "greeting key template not found in route.ts").not.toBeNull();
    // 뒤에 아무것도 안 붙는다 — 커플 id 를 붙이면 DB 가 거부한다.
    expect(routeKeyLine?.[1] ?? "(missing)").toBe("");
  });

  it("DB 클레임 함수의 인사 키 규칙이 정확히 그 모양이다", () => {
    const sql = latestMigrationDefining("v_expected_greeting_key");
    expect(sql).toContain("v_expected_greeting_key text := 'greeting:' || p_user_id::text;");
    // 정확 일치 비교 — 접두 일치(LIKE)가 아니다. 라우트가 접미를 붙이면 안 되는 이유.
    expect(sql).toMatch(/p_request_key = v_expected_greeting_key/u);
  });
});
