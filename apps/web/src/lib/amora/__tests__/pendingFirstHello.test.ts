import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import {
  consumePendingAmoraFirstHello,
  dismissAmoraFirstHelloBubble,
  getDeliveredAmoraFirstHello,
  parsePendingAmoraFirstHello,
  peekPendingAmoraFirstHello,
  PENDING_AMORA_FIRST_HELLO_KEY,
  PENDING_AMORA_FIRST_HELLO_TTL_MS,
  rememberPendingAmoraFirstHello,
  resetAmoraFirstHelloMemory,
  serializePendingAmoraFirstHello,
  type AmoraFirstHelloStorage,
} from "../pendingFirstHello";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../../..");

const NOW = Date.parse("2026-08-20T09:00:00.000Z");
const OWNER = "user-1";
const HELLO = {
  preview: "오늘은 딱 한 가지만 정해볼까요?",
  body: "안녕하세요, 아모라예요.\n\n오늘은 딱 한 가지만 정해볼까요?",
};

function makeStorage(initial: Record<string, string> = {}): AmoraFirstHelloStorage & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

beforeEach(() => {
  resetAmoraFirstHelloMemory();
});

describe("아모라 첫마디는 새로고침을 건너서 남는다", () => {
  it("보관해 두면 다시 마운트된 화면이 그대로 꺼내 본다", () => {
    // 안내 완료는 이미 계정에 적혀 다시 뜨지 않는다. 여기서 복원하지 못하면 그 계정은
    // 첫마디를 영영 못 만난다.
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });

    const pending = peekPendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW + 60_000 });
    expect(pending?.body).toBe(HELLO.body);
    expect(pending?.bubbleDismissed).toBe(false);
  });

  it("대화 화면이 가져가면 보관에서 지워진다", () => {
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });

    expect(consumePendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW })?.body).toBe(
      HELLO.body,
    );
    expect(storage.data[PENDING_AMORA_FIRST_HELLO_KEY]).toBeUndefined();
    expect(peekPendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW })).toBeNull();
  });

  it("같은 페이지 로드 안에서 화면이 다시 마운트되면 이미 건넨 인사를 다시 준다", () => {
    // 개발 모드의 이중 마운트나 탭 전환으로 인사가 사라지면 안 된다.
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });
    consumePendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW });

    expect(consumePendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW })?.body).toBe(
      HELLO.body,
    );
    expect(getDeliveredAmoraFirstHello(OWNER)?.body).toBe(HELLO.body);
  });

  it("말풍선을 닫아도 첫마디는 대화 화면에 남는다", () => {
    // 말풍선은 알림이고 첫마디는 인사다. "알림 봤다"가 "인사 필요 없다"는 아니다.
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });
    dismissAmoraFirstHelloBubble({ ownerId: OWNER, storage, now: NOW });

    const pending = peekPendingAmoraFirstHello({ ownerId: OWNER, storage, now: NOW });
    expect(pending?.bubbleDismissed).toBe(true);
    expect(pending?.body).toBe(HELLO.body);
  });

  it("3일이 지나면 없는 것으로 본다", () => {
    // "결혼식까지 N일" 같은 그때의 셈을 한 달 뒤에 보여주면 인사가 아니라 틀린 정보다.
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });

    expect(
      peekPendingAmoraFirstHello({
        ownerId: OWNER,
        storage,
        now: NOW + PENDING_AMORA_FIRST_HELLO_TTL_MS,
      }),
    ).not.toBeNull();
    expect(
      peekPendingAmoraFirstHello({
        ownerId: OWNER,
        storage,
        now: NOW + PENDING_AMORA_FIRST_HELLO_TTL_MS + 1,
      }),
    ).toBeNull();
  });

  it("다른 사람이 로그인해 있으면 남의 인사를 돌려주지 않고 지운다", () => {
    // 브라우저는 폰과 달리 여러 사람이 쓴다. 남의 예식일이 담긴 인사가 다음 사람
    // 화면에 뜨면 안 된다.
    const storage = makeStorage();
    rememberPendingAmoraFirstHello(HELLO, { ownerId: OWNER, storage, now: NOW });

    expect(peekPendingAmoraFirstHello({ ownerId: "user-2", storage, now: NOW })).toBeNull();
    expect(storage.data[PENDING_AMORA_FIRST_HELLO_KEY]).toBeUndefined();
  });

  it("주인을 모르면 아예 보관하지 않는다", () => {
    const storage = makeStorage();
    expect(rememberPendingAmoraFirstHello(HELLO, { ownerId: null, storage, now: NOW })).toBeNull();
    expect(storage.data[PENDING_AMORA_FIRST_HELLO_KEY]).toBeUndefined();
  });

  it("깨진 값·시계가 뒤로 간 값은 조용히 버린다", () => {
    expect(parsePendingAmoraFirstHello("{", NOW)).toBeNull();
    expect(parsePendingAmoraFirstHello(JSON.stringify({ ...HELLO, savedAt: NOW }), NOW)).toBeNull();
    expect(
      parsePendingAmoraFirstHello(
        serializePendingAmoraFirstHello({
          ...HELLO,
          ownerId: OWNER,
          savedAt: NOW + 60_000,
          bubbleDismissed: false,
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("첫마디는 두 대화 화면 모두에서 보인다", () => {
  it("앱 틀의 아모라 자리가 보관을 쓰고, 열면 소비한다", () => {
    // 2026-11-13: 둥근 버튼·첫마디 말풍선·옆 패널이 앱 틀(`AppClientLayout`)에서 아모라 자리(`AmoraDockHost`)로
    // 옮겨 갔다. 옮겨 간 파일만 보면 앱 틀이 그 자리를 빼도 이 시험이 초록이므로, 앱 틀이 감싸는지도 함께 본다.
    const layout = readFileSync(path.join(srcRoot, "app/(app)/AppClientLayout.tsx"), "utf8");
    expect(layout).toContain("<AmoraDockHost launcher=");
    const host = readFileSync(path.join(srcRoot, "components/app/amora/AmoraDockHost.tsx"), "utf8");
    expect(host).toContain("peekPendingAmoraFirstHello({ ownerId })");
    expect(host).toContain("rememberPendingAmoraFirstHello(hello,");
    expect(host).toContain("consumePendingAmoraFirstHello({ ownerId: ownerIdRef.current })");
    expect(host).toContain("dismissAmoraFirstHelloBubble({ ownerId: ownerIdRef.current })");
  });

  it("전체 페이지 대화도 첫마디를 꺼내 그리고, 인사를 두 번 하지 않는다", () => {
    // 사이드바의 "아모라"는 /chat으로 간다. 거기서 못 보면 그 사람은 첫마디를 아예 못 만난다.
    const chat = readFileSync(path.join(srcRoot, "components/app/chat/ChatContent.tsx"), "utf8");
    expect(chat).toContain("consumePendingAmoraFirstHello({ ownerId })");
    expect(chat).toContain('data-testid="amora-first-hello-message"');
    // 첫마디가 있으면 모델에게 인사를 다시 요청하지 않는다.
    expect(chat).toContain("!firstHelloChecked ||");
    expect(chat).toContain("firstHello ||");
  });
});
