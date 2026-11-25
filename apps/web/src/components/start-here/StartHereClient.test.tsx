import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_AMORA_PREFILL_STORAGE_KEY } from "@/lib/chat/demoHandoff";
import { START_HERE_DATE_HANDOFF_KEY } from "@/lib/marketing/startHereDateHandoff";

const HANDOFF_ID = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  captureEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: mocks.captureEvent,
}));

import StartHereClient from "./StartHereClient";

describe("StartHereClient first visit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 이 describe 는 **공개 체험이 켜진 상태**의 동작을 잰다. 기본값은 꺼짐이므로
    // 명시한다 (닫힌 상태는 아래 별도 describe 가 잰다).
    vi.stubEnv("NEXT_PUBLIC_DEMO_TRIAL_ENABLED", "true");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T09:00:00+09:00"));
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => HANDOFF_ID });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ alreadySignedIn: false }),
    }));
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/start-here#date=2027-05-01");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("turns one date into a calm priority and hands it directly to Amora", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(container.textContent).toContain(
      "기본 확인 시점은 지났지만, 지금부터 하나씩 확인해요",
    );
    expect(container.textContent).not.toMatch(/\d+일 지남/);

    const amoraButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("이 날짜로 아모라에게 물어보기"),
    );
    expect(amoraButton).toBeDefined();

    await act(async () => {
      amoraButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const handoff = window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY);
    expect(handoff).toContain("결혼식 날짜는 2027-05-01");
    expect(handoff).toContain("이번 주에 할 한 가지만");
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
  });

  it("keeps the landing date and renders priorities when effects replay in Strict Mode", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <StartHereClient />
        </StrictMode>,
      );
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(window.location.hash).toBe("");
  });

  it("consumes the browser-only landing handoff after a client-side route change", async () => {
    window.history.replaceState({}, "", "/start-here");
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");

    await act(async () => {
      root.render(
        <StrictMode>
          <StartHereClient />
        </StrictMode>,
      );
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2027-05-01",
    );
    expect(container.textContent).toContain("먼저 이 세 가지를 봐요");
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("prefers an explicit fragment date over a stale stored handoff", async () => {
    window.history.replaceState({}, "", "/start-here#date=2028-06-02");
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, "2027-05-01");

    await act(async () => root.render(<StartHereClient />));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2028-06-02",
    );
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("uses the fragment and clears it even when session storage cannot be read", async () => {
    window.history.replaceState({}, "", "/start-here#date=2028-06-02");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    await act(async () => root.render(<StartHereClient />));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      "2028-06-02",
    );
    expect(window.location.hash).toBe("");
  });

  it("offers a direct Amora path when the couple has not chosen a date yet", async () => {
    window.history.replaceState({}, "", "/start-here");
    await act(async () => {
      root.render(<StartHereClient />);
    });

    const undatedButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("날짜 없이 기준부터 물어보기"),
    );
    expect(undatedButton).toBeDefined();

    const smallWeddingButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("작게 준비해요"),
    );
    await act(async () => smallWeddingButton?.click());

    await act(async () => {
      undatedButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "아직 결혼식 날짜가 정해지지 않았어요",
    );
    expect(window.sessionStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "결혼식은 작게 준비하고 싶어요",
    );
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_amora_start_click",
      { source: "start_here_without_date" },
    );
    expect(mocks.push).toHaveBeenCalledWith("/wedding/chat");
  });

  it("does not leave very-early planners at a dead end", async () => {
    window.history.replaceState({}, "", "/start-here#date=2030-05-01");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    for (const startingPoint of [
      "편안한 예산 범위",
      "초대할 사람의 범위",
      "원하는 크기와 분위기",
    ]) {
      expect(container.textContent).toContain(startingPoint);
    }
    expect(container.textContent).toContain("이 세 가지를 아모라와 정하기");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_result_viewed",
      { source: "early" },
    );
  });

  // 2026-08-21에 「배우자 부모님께 첫인사」가 D-390에서 시작하는 첫 분야가 되면서 이 경계가
  // 옮겨졌다. 예전에는 D-334에서 시작한 분야가 둘뿐이라 남는 자리를 다음 것으로 채웠는데,
  // 이제 그 자리에서는 셋이 이미 시작해 채울 자리가 없다. 검사가 보는 것은 날짜가 아니라
  // "시작한 것이 셋보다 적으면 다음 것을 이름 붙여 채운다"이고, 그 창이 D-361~390이다.
  it("fills the 361–390 day boundary with clearly labeled upcoming items", async () => {
    window.history.replaceState({}, "", "/start-here#date=2027-08-11");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const priorityItems = container.querySelectorAll("#start-result-panel ol > li");
    expect(priorityItems).toHaveLength(3);
    expect(container.textContent).toContain("배우자 부모님께 첫인사");
    expect(container.textContent).toContain("부모님 첫 만남");
    expect(container.textContent).toContain("결혼식장");
    expect(container.textContent).toContain("다음 기본 확인 시작까지");
    expect(container.textContent).toContain("지금은 기준만 미리 맞춰봐도 돼요");
  });

  it("treats a past date as a correction state instead of expired priorities", async () => {
    window.history.replaceState({}, "", "/start-here#date=2026-07-31");
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("이미 지난 날짜예요.");
    expect(container.textContent).toContain("다른 날짜 선택하기");
    expect(container.textContent).not.toContain("지금은 이것부터");
    expect(container.textContent).not.toContain("이 날짜로 아모라에게 물어보기");
  });

  it("keeps the visible priorities for signup without putting them in the URL", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const signupLink = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("계정 만들고 계속 관리하기"),
    );
    expect(signupLink?.getAttribute("href")).toBe(
      "/login?mode=signup&redirect=%2Fwedding%2Fchat&source=start-here",
    );
    signupLink?.addEventListener("click", (event) => event.preventDefault());
    await act(async () => {
      signupLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(window.localStorage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "결혼식 날짜는 2027-05-01",
    );
    expect(mocks.push).toHaveBeenCalledWith(
      `/login?mode=signup&redirect=%2Fwedding%2Fchat%3FstartHereHandoff%3D${HANDOFF_ID}&source=start-here`,
    );
    expect(window.location.search).toBe("");
    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_signup_click",
      { source: "priorities" },
    );
  });

  it("tracks only a bounded date-selection state without the selected date", async () => {
    window.history.replaceState({}, "", "/start-here");
    await act(async () => root.render(<StartHereClient />));
    const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(dateInput, "2027-06-07");
      dateInput?.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith(
      "start_here_date_selected",
      { source: "date_input" },
    );
    expect(JSON.stringify(mocks.captureEvent.mock.calls)).not.toContain("2027-06-07");
  });

  it("keeps the mobile result below the sticky header when using the jump link", async () => {
    await act(async () => {
      root.render(<StartHereClient />);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.querySelector("#start-result-panel")?.className).toContain(
      "scroll-mt-16",
    );
  });
});

/**
 * 체험을 닫으면 `StartDemoButton` 이 아무것도 그리지 않는다. 이 화면은 그 버튼을
 * **세 자리**에서 쓰므로, 닫는 순간 갈 곳이 사라지는 자리가 생길 수 있다.
 *
 * 실제로 하나가 그랬다: "아직 날짜가 없나요?" 뒤에 버튼만 있어서, 버튼이 빠지면
 * **질문만 덩그러니 남고 아무 데도 안 갔다.** 나머지 두 자리는 옆에 "계정 만들고…"
 * 링크가 있어 괜찮았다.
 *
 * 원래 있던 검사 이름이 "아주 이른 준비자를 막다른 길에 두지 않는다" 였는데,
 * 그 검사는 **체험 버튼의 글자**를 봤다. 스위치를 끄면 그 글자가 사라지므로
 * 검사가 지키려던 것(= 앞으로 갈 길이 있다)을 못 지킨다. 여기서 그것을 잰다.
 */
describe("StartHereClient 체험이 닫혀 있을 때", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 스위치를 건드리지 않는다 — 기본값이 닫힘이라는 것 자체를 잰다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T09:00:00+09:00"));
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => HANDOFF_ID });
    window.sessionStorage.clear();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function renderAt(hash: string): Promise<void> {
    window.history.replaceState({}, "", `/start-here${hash}`);
    await act(async () => root.render(<StartHereClient />));
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
  }

  it("측정기 확인 — 닫힌 상태에서는 체험 버튼 글자가 하나도 없다", async () => {
    await renderAt("#date=2030-05-01");
    for (const label of [
      "날짜 없이 기준부터 물어보기",
      "이 날짜로 아모라에게 물어보기",
      "이 세 가지를 아모라와 정하기",
    ]) {
      expect(container.textContent ?? "", `"${label}" 가 남아 있다`).not.toContain(label);
    }
  });

  it("아주 이른 준비자에게 갈 길이 남아 있다", async () => {
    await renderAt("#date=2030-05-01");
    for (const startingPoint of [
      "편안한 예산 범위",
      "초대할 사람의 범위",
      "원하는 크기와 분위기",
    ]) {
      expect(container.textContent).toContain(startingPoint);
    }
    expect(container.textContent, "세 가지를 보여 주고 다음 걸음이 없다")
      .toContain("계정 만들고 천천히 관리하기");
  });

  it("날짜가 있는 사람에게도 갈 길이 남아 있다", async () => {
    await renderAt("#date=2027-05-01");
    expect(container.textContent).toContain("계정 만들고 계속 관리하기");
  });

  it("\"아직 날짜가 없나요?\" 가 아무 데도 못 가는 문장으로 남지 않는다", async () => {
    await renderAt("#date=2030-05-01");
    const text = container.textContent ?? "";
    expect(text, "전제 확인 — 질문 자체가 사라졌다").toContain("아직 날짜가 없나요?");
    const after = text.slice(text.indexOf("아직 날짜가 없나요?"));
    expect(after.slice(0, 60), "질문 뒤에 갈 곳이 없다")
      .toContain("날짜 없이 기준부터 시작하기");
  });

  it("체험을 전제로 한 설명 문구가 남지 않는다", async () => {
    await renderAt("#date=2027-05-01");
    expect(container.textContent ?? "", "닫아 놓고 '로그인 없이 여는 체험' 이라고 말한다")
      .not.toContain("로그인 없이 여는 체험");
  });
});

