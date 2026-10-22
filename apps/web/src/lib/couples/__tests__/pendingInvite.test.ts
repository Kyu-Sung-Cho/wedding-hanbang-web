import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  clearPendingCoupleInviteCode,
  consumePendingCoupleInviteCode,
  parsePendingInvite,
  peekPendingCoupleInviteCode,
  PENDING_INVITE_STORAGE_KEY,
  PENDING_INVITE_TTL_MS,
  rememberPendingCoupleInviteCode,
  resolveDefaultPendingInviteStorage,
  serializePendingInvite,
  type PendingInviteStorage,
} from "../pendingInvite";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../../..");

const NOW = Date.parse("2026-08-20T09:00:00.000Z");
const CODE = "WH-A3F91B2C7D40";

function makeStorage(initial: Record<string, string> = {}): PendingInviteStorage & {
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

describe("초대 코드는 로그인 왕복 동안만 보관된다", () => {
  it("보관했다가 온보딩에서 그대로 꺼낸다", () => {
    const storage = makeStorage();
    expect(rememberPendingCoupleInviteCode(CODE, { storage, now: NOW })).toBe(CODE);
    expect(consumePendingCoupleInviteCode({ storage, now: NOW + 1000 })).toBe(CODE);
  });

  it("꺼내는 즉시 지워져 두 번 쓰이지 않는다", () => {
    // 온보딩을 마치고 다시 들어왔을 때 예전 링크의 코드가 되살아나면, 이미 연결된
    // 사람이 남의 코드로 합류를 시도한다.
    const storage = makeStorage();
    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });

    expect(consumePendingCoupleInviteCode({ storage, now: NOW })).toBe(CODE);
    expect(storage.data[PENDING_INVITE_STORAGE_KEY]).toBeUndefined();
    expect(consumePendingCoupleInviteCode({ storage, now: NOW })).toBeNull();
  });

  it("30분이 지나면 없는 것으로 본다", () => {
    const storage = makeStorage();
    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });

    expect(
      consumePendingCoupleInviteCode({ storage, now: NOW + PENDING_INVITE_TTL_MS }),
    ).toBe(CODE);

    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });
    expect(
      consumePendingCoupleInviteCode({ storage, now: NOW + PENDING_INVITE_TTL_MS + 1 }),
    ).toBeNull();
  });

  it("시계가 뒤로 돌아간 뒤 저장된 값도 버린다", () => {
    // 미래 시각을 살려두면 그 값은 영영 만료되지 않는다.
    const storage = makeStorage({
      [PENDING_INVITE_STORAGE_KEY]: serializePendingInvite(CODE, NOW + 60_000),
    });
    expect(consumePendingCoupleInviteCode({ storage, now: NOW })).toBeNull();
  });

  it("코드 모양이 아니면 보관하지 않고, 들고 있던 값도 지운다", () => {
    const storage = makeStorage();
    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });

    expect(rememberPendingCoupleInviteCode("안녕하세요", { storage, now: NOW })).toBeNull();
    expect(storage.data[PENDING_INVITE_STORAGE_KEY]).toBeUndefined();
  });

  it("소문자로 적혀 와도 정본 형식으로 다듬어 보관한다", () => {
    const storage = makeStorage();
    expect(rememberPendingCoupleInviteCode(" wh-a3f91b2c7d40 ", { storage, now: NOW })).toBe(
      CODE,
    );
    expect(consumePendingCoupleInviteCode({ storage, now: NOW })).toBe(CODE);
  });

  it("깨진 값·낯선 모양은 조용히 없는 것으로 본다", () => {
    expect(parsePendingInvite("{", NOW)).toBeNull();
    expect(parsePendingInvite("null", NOW)).toBeNull();
    expect(parsePendingInvite(JSON.stringify([CODE, NOW]), NOW)).toBeNull();
    expect(parsePendingInvite(JSON.stringify({ code: CODE }), NOW)).toBeNull();
    expect(parsePendingInvite(JSON.stringify({ savedAt: NOW }), NOW)).toBeNull();
  });

  it("저장소가 막혀 있으면 보관에 성공했다고 말하지 않는다", () => {
    // 웹에는 메모리 대체재가 없다. 실패를 성공처럼 돌려주면 부르는 쪽은 옛 경로(`#`)를
    // 버리고, 사람은 코드를 잃고도 아무 표시를 못 받는다.
    const blocked: PendingInviteStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(rememberPendingCoupleInviteCode(CODE, { storage: blocked, now: NOW })).toBeNull();
    expect(consumePendingCoupleInviteCode({ storage: blocked, now: NOW })).toBeNull();
    expect(rememberPendingCoupleInviteCode(CODE, { storage: null, now: NOW })).toBeNull();
  });
});

describe("초대 링크는 서버 307을 건너 코드를 나른다", () => {
  it("착지 화면이 보관에 넣고 코드 없는 주소로 보낸다", () => {
    const landing = readFileSync(
      path.join(srcRoot, "app/invite/InviteLandingClient.tsx"),
      "utf8",
    );
    expect(landing).toContain("rememberPendingCoupleInviteCode(code)");
    // 보관에 넣었을 때만 주소에서 코드를 뺀다.
    expect(landing).toContain("router.push(ONBOARDING_PATH)");
  });

  it("온보딩은 마운트되면 보관을 읽고 완료 시점에 지운다", () => {
    const onboarding = readFileSync(
      path.join(srcRoot, "app/(auth)/onboarding/page.tsx"),
      "utf8",
    );
    expect(onboarding).toContain("peekPendingCoupleInviteCode()");
    expect(onboarding).toContain("clearPendingCoupleInviteCode()");
    // 이미 로그인한 사람은 307을 안 맞고 도착하므로 해시 경로도 살아 있어야 한다.
    expect(onboarding).toContain("parseCoupleInviteFragment(window.location.hash)");
  });

  it("peek는 유효한 코드를 지우지 않고 만료된 코드만 지운다", () => {
    const storage = makeStorage();
    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });

    expect(peekPendingCoupleInviteCode({ storage, now: NOW + 1000 })).toBe(CODE);
    expect(storage.data[PENDING_INVITE_STORAGE_KEY]).toBeDefined();

    expect(
      peekPendingCoupleInviteCode({ storage, now: NOW + PENDING_INVITE_TTL_MS + 1 }),
    ).toBeNull();
    expect(storage.data[PENDING_INVITE_STORAGE_KEY]).toBeUndefined();

    rememberPendingCoupleInviteCode(CODE, { storage, now: NOW });
    clearPendingCoupleInviteCode({ storage });
    expect(storage.data[PENDING_INVITE_STORAGE_KEY]).toBeUndefined();
  });

  it("초대 코드는 온보딩 저장소(persist)에 들어가지 않는다", () => {
    // 커플 공간 열쇠라 보관 기간이 다르다. 한쪽만 지우면 다른 쪽에서 되살아난다.
    const store = readFileSync(path.join(srcRoot, "stores/onboardingStore.ts"), "utf8");
    expect(store).toContain("delete restored.partnerInviteCode;");
    const partialize = store.slice(store.indexOf("partialize:"));
    expect(partialize).not.toContain("partnerInviteCode");
  });
});

describe("메일 인증 왕복", () => {
  it("탭을 건너는 저장소를 기본으로 고른다", () => {
    // 계정 없는 파트너 — 초대의 주 경로 — 는 가입 시 이메일 확인을 강제받는다.
    // 그 링크는 메일함에서 눌리므로 **새 탭**이다. sessionStorage는 거기까지 가지 않아
    // 코드가 그 순간 사라지고, 사람은 다시 손으로 옮겨 적는다.
    const chosen = resolveDefaultPendingInviteStorage();
    expect(chosen).toBe(window.localStorage);
    expect(chosen).not.toBe(window.sessionStorage);
  });

  it("고른 저장소에 실제로 쓰고, 거기서 다시 읽는다", () => {
    // 기본 저장소를 넘기지 않고 부르는 실제 호출부와 같은 경로다.
    window.localStorage.clear();
    window.sessionStorage.clear();

    expect(rememberPendingCoupleInviteCode("WH-A3F91B2C7D40")).toBe("WH-A3F91B2C7D40");
    // 새 탭에서도 읽히는 자리에 있어야 한다.
    expect(window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBeNull();

    expect(consumePendingCoupleInviteCode()).toBe("WH-A3F91B2C7D40");
    // 한 번 쓰이면 지운다 — 탭을 건너는 대신 오래 남지 않아야 한다.
    expect(window.localStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBeNull();
  });

  it("오래 남지 않는다 — 만료가 없으면 이 선택은 위험하다", () => {
    expect(PENDING_INVITE_TTL_MS).toBe(30 * 60 * 1000);
  });
});
