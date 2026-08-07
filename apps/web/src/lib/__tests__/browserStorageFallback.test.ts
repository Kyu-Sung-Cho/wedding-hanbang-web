// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { BROWSER_STORAGE_FALLBACK_SNIPPET } from "../browserStorageFallback";

/**
 * 저장소가 막힌 브라우저에서도 첫 화면이 열려야 한다는 계약.
 *
 * 이 스니펫이 없으면 `sessionStorage` 접근이 던지는 환경에서 Realtime 소켓
 * 생성자가 그대로 위로 던져 `(community)` 화면이 통째로 에러가 된다(운영 실측).
 * 스니펫 자체가 던지면 더 나쁘므로, 어떤 상황에서도 조용히 끝나는 것까지 본다.
 */

const run = () => {
  // eslint-disable-next-line no-new-func -- 배포되는 문자열을 그대로 실행해야 계약이 성립한다
  new Function(BROWSER_STORAGE_FALLBACK_SNIPPET)();
};

const breakStorage = (name: "sessionStorage" | "localStorage", how: "throw-on-get" | "throw-on-set") => {
  Object.defineProperty(window, name, {
    configurable: true,
    ...(how === "throw-on-get"
      ? { get() { throw new Error("blocked"); } }
      : {
          value: {
            getItem: () => null,
            setItem: () => { throw new Error("QuotaExceededError"); },
            removeItem: () => {},
            clear: () => {},
            key: () => null,
            length: 0,
          },
        }),
  });
};

const originals = {
  sessionStorage: Object.getOwnPropertyDescriptor(window, "sessionStorage"),
  localStorage: Object.getOwnPropertyDescriptor(window, "localStorage"),
};

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
  }
});

describe("browser storage fallback", () => {
  it("leaves a working browser completely alone", () => {
    window.sessionStorage.setItem("keep", "me");
    const before = window.sessionStorage;

    run();

    expect(window.sessionStorage).toBe(before);
    expect(window.sessionStorage.getItem("keep")).toBe("me");
    window.sessionStorage.removeItem("keep");
  });

  it("installs a working store when access itself throws", () => {
    breakStorage("sessionStorage", "throw-on-get");
    expect(() => window.sessionStorage).toThrow();

    run();

    expect(() => window.sessionStorage).not.toThrow();
    window.sessionStorage.setItem("a", "1");
    expect(window.sessionStorage.getItem("a")).toBe("1");
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.key(0)).toBe("a");
    window.sessionStorage.removeItem("a");
    expect(window.sessionStorage.getItem("a")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("also covers the quota case where only writing throws", () => {
    // 사파리 프라이빗 모드의 고전적인 실패 모양 — 읽기는 되고 쓰기만 던진다.
    breakStorage("sessionStorage", "throw-on-set");

    run();

    expect(() => window.sessionStorage.setItem("b", "2")).not.toThrow();
    expect(window.sessionStorage.getItem("b")).toBe("2");
  });

  it("covers localStorage by the same rule", () => {
    breakStorage("localStorage", "throw-on-get");

    run();

    expect(() => window.localStorage).not.toThrow();
    window.localStorage.setItem("c", "3");
    expect(window.localStorage.getItem("c")).toBe("3");
  });

  it("never throws, even when the property cannot be replaced", () => {
    // 실제 `configurable: false`를 걸면 되돌릴 수 없어 이후 테스트까지 오염된다.
    // 갈아끼우기가 실패하는 상황만 재현한다 — 계약은 "그래도 던지지 않는다"이다.
    breakStorage("sessionStorage", "throw-on-get");
    const realDefineProperty = Object.defineProperty;
    Object.defineProperty = ((target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
      if (key === "sessionStorage") throw new TypeError("cannot redefine property");
      return realDefineProperty(target, key, descriptor);
    }) as typeof Object.defineProperty;

    try {
      // 여기서 던지면 스니펫이 첫 화면을 깨뜨리는 셈이라 원래 문제보다 나쁘다.
      expect(() => run()).not.toThrow();
    } finally {
      Object.defineProperty = realDefineProperty;
    }
  });

  it("returns null for a missing key instead of undefined", () => {
    breakStorage("sessionStorage", "throw-on-get");
    run();
    // Storage 인터페이스 계약: 없는 키는 null이다. undefined면 호출부가 갈린다.
    expect(window.sessionStorage.getItem("nope")).toBeNull();
  });
});
