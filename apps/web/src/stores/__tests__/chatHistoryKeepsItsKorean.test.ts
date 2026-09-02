import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 저장된 대화가 화면에 한글로 도착하는가.
 *
 * ## 2026-09-02 QA 재검이 말한 것
 *
 * 라운지는 대체로 깨끗한데 **일정 화면과 채팅 기록**에 깨진 글자가 남아 있었다
 * (한 계정에서만). 라운지가 깨끗했던 이유는 라운지가 다가오는 일정 서너 개만
 * 보여주기 때문이다 — 깨진 옛 기록은 일정 화면과 채팅 기록에만 나온다.
 *
 * 채팅 기록은 앞선 수정이 **한 번도 지나가지 않는 길**이었다. 일정과 아모라
 * 기록만 고쳤고 `chat_messages` 는 그대로였다.
 *
 * ## 왜 소스를 읽어서 검사하는가
 *
 * `dbRowToMessage` 는 모듈 바깥으로 나가지 않고, 이 스토어를 세우려면 Supabase
 * 클라이언트·인증 스토어·실시간 구독까지 딸려 온다. 여기서 지키려는 것은 **기록을
 * 읽어 오는 길이 되돌리기를 지나는가** 하나이므로 그 줄을 직접 본다. 되돌리기
 * 자체의 정확성은 `packages/shared` 의 표적 검사가 든다.
 */

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const CHAT_STORE = read("src/stores/chatStore.ts");

function dbRowToMessageSource(): string {
  const start = CHAT_STORE.indexOf("function dbRowToMessage(");
  expect(start, "dbRowToMessage 를 못 찾았다").toBeGreaterThan(-1);
  const end = CHAT_STORE.indexOf("\nexport function ", start);
  expect(end, "dbRowToMessage 의 끝을 못 찾았다").toBeGreaterThan(start);
  return CHAT_STORE.slice(start, end);
}

describe("채팅 기록이 되돌리기를 지난다", () => {
  it("DB 행을 메시지로 바꾸는 자리가 본문과 metadata 를 모두 되돌린다", () => {
    const source = dbRowToMessageSource();
    expect(source).toContain("repairMojibake(row.content)");
    expect(source).toContain("repairMojibakeDeep(");
    // 되돌리기를 지나지 않는 옛 배선이 남아 있으면 안 된다.
    expect(source).not.toContain("content: row.content as string");
  });

  it("기록을 읽어 오는 세 길이 모두 그 자리를 지난다", () => {
    // 최초 적재 · 폴링 · 실시간. 하나라도 직접 행을 펴면 그 길만 깨진 채 남는다.
    for (const loader of ["loadMessages", "pollNewMessages", "subscribeToMessages"]) {
      const start = CHAT_STORE.indexOf(`${loader}:`);
      expect(start, `${loader} 를 못 찾았다`).toBeGreaterThan(-1);
    }
    // 스토어 전체에서 DB 행이 메시지가 되는 길은 이 함수 하나다.
    const directRowSpread = /content:\s*(?:row|m|message)\.content\s+as\s+string/g;
    expect([...CHAT_STORE.matchAll(directRowSpread)]).toHaveLength(0);
  });
});

/**
 * 채팅 본문은 **바꿔치지 않는다.**
 *
 * 라운지의 일정·기록 제목은 읽을 글자가 하나도 안 남았을 때 「제목을 읽지 못한 …」
 * 으로 물러난다. 짧은 라벨이고 사용자가 그 줄을 열어 다시 적을 수 있기 때문이다.
 *
 * 대화 말풍선은 다르다. 그것은 두 사람이 나눈 기록이고, 일부가 깨졌다고 통째로
 * 안내문으로 바꾸면 남아 있는 정보까지 사라진다. 되돌릴 수 있으면 되돌리고,
 * 되돌릴 수 없으면 있는 그대로 둔다.
 */
describe("대화 말풍선은 안내문으로 바꿔치지 않는다", () => {
  it("채팅 스토어가 본문을 대체 문구로 갈아끼우지 않는다", () => {
    expect(CHAT_STORE).not.toContain("읽지 못한");
    expect(CHAT_STORE).not.toContain("isUnreadableText");
  });
});
