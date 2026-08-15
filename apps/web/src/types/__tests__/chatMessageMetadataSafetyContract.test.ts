// @vitest-environment node

/**
 * `durable_safety_fence_confirmed`의 타입 계약.
 *
 * 이 필드는 결정적 안전 카드가 **원격 seal을 확인했는지**만 담는다. 서버는 이 값으로
 * 200과 503을 가르고(`api/chat/route.ts`), 클라이언트는 이 값으로 후속(follow-up) 자격을
 * 판단한다. 값이 쓰이는 곳은 늘었는데 `ChatMessageMetadata`에는 선언이 없어 web
 * typecheck가 세 곳에서 깨져 있었다(chatStore.ts 2041·2086·3022).
 *
 * 여기서 고정하는 것은 두 가지다.
 *   1. 타입에 선언이 있고 **불리언**이라는 것.
 *   2. 이 필드가 **내용을 담지 않는다**는 것. 안전 사유·분류·요약·상대 상태를 이 자리에
 *      끼워 넣으면 임시(ephemeral) 안전 카드가 내구 메타데이터로 원문을 흘리게 된다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const source = (relativePath: string) =>
  readFileSync(resolve(appRoot, relativePath), "utf8");

const FIELD = "durable_safety_fence_confirmed";

const types = source("src/types/database.types.ts");
const chatStore = source("src/stores/chatStore.ts");
const chatRoute = source("src/app/api/chat/route.ts");

describe("durable_safety_fence_confirmed 타입 계약", () => {
  it("ChatMessageMetadata에 선택적 불리언으로 선언돼 있다", () => {
    const metadataBlock = types.slice(
      types.indexOf("export interface ChatMessageMetadata {"),
      types.indexOf("export interface ChatMessageMetadata {") + 6_000,
    );
    expect(metadataBlock, "ChatMessageMetadata 블록을 찾지 못했다").toContain(FIELD);
    expect(metadataBlock).toMatch(
      new RegExp(`${FIELD}\\?\\s*:\\s*boolean\\s*;`, "u"),
    );
  });

  it("불리언이 아닌 타입으로 넓히지 않는다", () => {
    // 사유·분류·요약을 담으려는 순간 이 단언이 깨진다. 그게 이 테스트의 목적이다.
    const declaration = types.match(
      new RegExp(`${FIELD}\\?\\s*:\\s*([^;]+);`, "u"),
    )?.[1]?.trim();
    expect(declaration, "선언을 찾지 못했다").toBeTruthy();
    expect(declaration).toBe("boolean");
  });

  it("쓰는 쪽은 모두 불리언 값만 넘긴다", () => {
    // 문자열 리터럴/템플릿을 넘기는 곳이 하나라도 생기면 내용이 실려 나간다.
    const writers = [
      ["chatStore", chatStore],
      ["api/chat/route", chatRoute],
    ] as const;
    for (const [label, text] of writers) {
      const assignments = [
        ...text.matchAll(new RegExp(`${FIELD}\\s*:\\s*([^,\\n]+)`, "gu")),
      ].map((match) => match[1].trim());
      expect(assignments.length, `${label}에 ${FIELD} 사용처가 없다`).toBeGreaterThan(0);
      for (const value of assignments) {
        expect(value, `${label}가 ${FIELD}에 문자열을 넣는다: ${value}`)
          .not.toMatch(/^["'`]/u);
      }
    }
  });

  it("결정적 안전 카드를 만드는 세 지점이 모두 이 플래그를 남긴다", () => {
    // 한 곳이라도 빠지면 그 경로만 조용히 seal 미확인 상태로 후속 자격을 얻는다.
    const occurrences = chatStore.split(FIELD).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
