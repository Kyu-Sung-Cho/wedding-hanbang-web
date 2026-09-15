// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileAvatarEditor from "./ProfileAvatarEditor";
import ProfileAvatar from "@/components/ui/ProfileAvatar";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REVISION = "22222222-2222-4222-8222-222222222222";
const PHOTO = `/api/profile/avatar/image?userId=${OWNER}&version=${REVISION}`;
const profile: Profile = {
  id: OWNER, name: "홍길동", role: null, couple_id: null, avatar_url: null,
  onboarding_completed: true, onboarding_step: 4, is_admin: false, created_at: "", updated_at: "",
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("프로필 선택 저장 경계", () => {
  let root: Root;
  let container: HTMLDivElement;
  let original: ReturnType<typeof useAuthStore.getState>;
  const fetchMock = vi.fn<typeof fetch>();
  const createObjectURL = vi.fn(() => "blob:avatar-test");
  const revokeObjectURL = vi.fn();
  const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    original = useAuthStore.getState();
    useAuthStore.setState({ user: { id: OWNER, email: "test@example.invalid" }, profile: { ...profile }, isDemo: false });
    fetchMock.mockReset().mockImplementation(async (_input, init) => init?.method === "PUT"
      ? response({ avatar_url: "🌸", revision: REVISION }) : response({ avatar_url: null, revision: null }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    useAuthStore.setState(original); vi.unstubAllGlobals(); vi.clearAllMocks();
    if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate); else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  });
  function button(label: string) {
    const found = [...container.querySelectorAll("button")].find((node) => (node.getAttribute("aria-label") || node.textContent) === label);
    if (!found) throw new Error(`Missing button ${label}`); return found;
  }
  async function click(label: string) { await act(async () => { button(label).click(); }); }
  async function open() { await act(async () => root.render(<ProfileAvatarEditor />)); await click("프로필 꾸미기"); }
  function writes() { return fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"); }
  async function chooseFile(file: File) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  }

  it("선택과 취소는 저장하지 않으며 기본 표시는 한 글자다", async () => {
    await open(); expect(container.querySelector('[data-profile-avatar="initial"]')?.textContent).toBe("홍");
    await click("이모지"); await click("벚꽃");
    expect(container.querySelector('[data-profile-avatar="emoji"]')?.textContent).toBe("🌸");
    await click("취소"); expect(writes()).toHaveLength(0);
    expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
    expect(document.activeElement).toBe(button("프로필 꾸미기"));
  });

  it("확인된 저장만 반영하고 동시에 수정한 이름은 보존한다", async () => {
    await open(); await click("이모지"); await click("벚꽃");
    await act(async () => useAuthStore.setState({ profile: { ...profile, name: "새로운 이름", confirmed_role: "groom", confirmed_role_revision: REVISION } }));
    await click("저장");
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ kind: "emoji", emoji: "🌸", expected_revision: null, expected_user_id: OWNER });
    expect(useAuthStore.getState().profile).toMatchObject({ name: "새로운 이름", avatar_url: "🌸", confirmed_role: "groom", confirmed_role_revision: REVISION });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("프로필을 저장했어요.");
  });

  it("편집 시작 revision을 전송하고 충돌을 저장 성공으로 표시하지 않는다", async () => {
    // 충돌 뒤 서버 값을 다시 읽지 못하면, 누가 바꿨는지 단정하지 않고 다시 열어 확인하라고만 안내한다.
    let reads = 0;
    fetchMock.mockImplementation(async (_input,init)=>init?.method==="PUT"?response({code:"AVATAR_SAVE_CONFLICT"},409):(reads++ === 0 ? response({avatar_url:"🌷",revision:REVISION}) : response({ error: "unavailable" }, 503)));
    await open(); await click("이모지"); await click("벚꽃"); await click("저장");
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({kind:"emoji",emoji:"🌸",expected_revision:REVISION,expected_user_id:OWNER});
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("프로필이 이미 바뀌었어요. 취소한 뒤 다시 열어 확인해 주세요.");
    expect(container.textContent).not.toContain("다른 곳");
    expect(container.textContent).not.toContain("프로필을 저장했어요"); expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
  });

  describe("결과를 모르는 저장 실패 뒤 서버 값 다시 읽기", () => {
    // 2026-09-15 재확인: 저장 요청이 끊기거나 늦게 커밋되면 서버는 이미 저장했을 수 있다. 예전 revision을
    // 그대로 들고 다시 저장하면 409가 되고, 화면은 「다른 곳에서 프로필이 바뀌었어요」라고 단정했다.
    // 실제로 바꾼 것은 같은 브라우저의 직전 요청일 수 있다. 앱(profileAvatarPresentation.mjs)과 같은 복구를 한다.
    const OLD = REVISION;
    const NEW = "44444444-4444-4444-8444-444444444444";
    const abort = () => new DOMException("The operation was aborted.", "AbortError");
    function server(initial: { avatar_url: string | null; revision: string | null }) {
      const state = { current: initial, puts: [] as Array<() => Promise<Response>> };
      fetchMock.mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") { const next = state.puts.shift(); if (!next) throw new Error("unexpected PUT"); return next(); }
        return response(state.current);
      });
      return state;
    }
    function reads() { return fetchMock.mock.calls.filter(([, init]) => init?.method !== "PUT").length; }
    function alertText() { return container.querySelector('[role="alert"]')?.textContent ?? null; }

    it("보고된 순서: 끊긴 저장이 늦게 커밋되면 다시 누른 저장의 409를 저장 완료로 알아본다", async () => {
      const s = server({ avatar_url: null, revision: OLD });
      await open(); await click("이모지"); await click("벚꽃");
      // 1) 끊겼고 서버는 아직 예전 값이다 → 저장됐다고도, 바뀌었다고도 말하지 않는다.
      s.puts.push(async () => { throw abort(); });
      await click("저장");
      expect(reads()).toBe(2);
      expect(alertText()).toBe("프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
      // 2) 서버가 늦게 저장했다. 같은 revision으로 다시 누르면 409 — 다시 읽으면 고른 이모지다.
      s.current = { avatar_url: "🌸", revision: NEW };
      s.puts.push(async () => response({ code: "AVATAR_SAVE_CONFLICT" }, 409));
      await click("저장");
      expect(JSON.parse(writes()[1][1]?.body as string)).toMatchObject({ expected_revision: OLD });
      expect(reads()).toBe(3);
      expect(useAuthStore.getState().profile?.avatar_url).toBe("🌸");
      expect(container.querySelector('[role="status"]')?.textContent).toBe("프로필을 저장했어요.");
      expect(container.textContent).not.toContain("바뀌었어요");
    });

    it.each([
      ["끊김", async () => { throw abort(); }],
      ["네트워크 오류", async () => { throw new TypeError("Failed to fetch"); }],
      ["5xx", async () => response({ code: "AVATAR_SAVE_FAILED" }, 503)],
      ["모양이 틀린 2xx", async () => response({ avatar_url: "🌸" })],
    ] as const)("%s 뒤 서버에 고른 값이 있으면 저장으로 본다", async (_label, put) => {
      const s = server({ avatar_url: null, revision: null });
      await open(); await click("이모지"); await click("벚꽃");
      s.current = { avatar_url: "🌸", revision: NEW }; s.puts.push(put);
      await click("저장");
      expect(reads()).toBe(2);
      expect(useAuthStore.getState().profile?.avatar_url).toBe("🌸");
      expect(container.querySelector('[role="status"]')?.textContent).toBe("프로필을 저장했어요.");
    });

    it("기본 글자로 되돌리기가 끊겼지만 저장됐으면 저장으로 본다", async () => {
      const s = server({ avatar_url: "🌷", revision: OLD });
      await act(async () => useAuthStore.setState({ profile: { ...profile, avatar_url: "🌷" } }));
      await open(); await click("기본 글자");
      s.current = { avatar_url: null, revision: NEW }; s.puts.push(async () => { throw abort(); });
      await click("저장");
      expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent).toBe("프로필을 저장했어요.");
    });

    it("충돌 뒤 서버 값이 고른 값과 다르면 편집기를 그 값으로 맞추고 누가 바꿨는지 말하지 않는다", async () => {
      const s = server({ avatar_url: null, revision: OLD });
      await open(); await click("이모지"); await click("벚꽃");
      s.current = { avatar_url: "🐱", revision: NEW }; s.puts.push(async () => response({ code: "AVATAR_SAVE_CONFLICT" }, 409));
      await click("저장");
      expect(alertText()).toBe("프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요.");
      expect(container.textContent).not.toContain("다른 곳");
      expect(container.textContent).not.toContain("프로필을 저장했어요");
      expect(container.querySelector('[data-profile-avatar="emoji"]')?.textContent).toBe("🐱");
      expect(useAuthStore.getState().profile?.avatar_url).toBe("🐱");
      // 다음 저장은 새로 읽은 revision을 보낸다 — 같은 409가 되풀이되지 않는다.
      s.puts.push(async () => response({ avatar_url: "🌸", revision: "55555555-5555-4555-8555-555555555555" }));
      await click("벚꽃"); await click("저장");
      expect(JSON.parse(writes()[1][1]?.body as string)).toEqual({ kind: "emoji", emoji: "🌸", expected_revision: NEW, expected_user_id: OWNER });
      expect(useAuthStore.getState().profile?.avatar_url).toBe("🌸");
    });

    it("사진은 같은 사진인지 증명할 수 없어, 끊긴 뒤 새 사진이 있으면 저장했다고 하지 않고 저장된 모습을 보여 준다", async () => {
      const s = server({ avatar_url: null, revision: null });
      await open(); await click("사진");
      await chooseFile(new File(["mock PNG handled by server"], "avatar.png", { type: "image/png" }));
      const saved = `/api/profile/avatar/image?userId=${OWNER}&version=${NEW}`;
      s.current = { avatar_url: saved, revision: NEW }; s.puts.push(async () => { throw abort(); });
      await click("저장");
      expect(alertText()).toBe("프로필이 이미 바뀌었어요. 지금 저장된 모습을 확인해 주세요.");
      expect(container.textContent).not.toContain("프로필을 저장했어요");
      expect(container.textContent).not.toContain("선택한 사진");
      expect(container.querySelector("img")?.getAttribute("src")).toBe(saved);
      expect(button("저장").disabled).toBe(true);
      expect(useAuthStore.getState().profile?.avatar_url).toBe(saved);
    });

    it.each([
      [response({ code: "INVALID_AVATAR" }, 400), "사진을 읽을 수 없어요. 다른 JPG, PNG, WebP 사진을 선택해 주세요."],
      [response({ code: "AVATAR_TOO_LARGE" }, 413), "4MB 이하의 사진을 선택해 주세요."],
      [response({ error: "요청이 너무 많습니다." }, 429), "프로필을 너무 자주 바꿨어요. 잠시 뒤 다시 시도해 주세요."],
      [response({ code: "AVATAR_OWNER_CHANGED" }, 409), "계정 상태가 바뀌었어요. 현재 계정으로 프로필을 다시 열어 주세요."],
      [response({ code: "AUTH_REQUIRED" }, 401), "로그인 상태를 다시 확인해 주세요."],
    ] as const)("저장 전에 거절된 응답은 다시 읽지 않고 그 안내를 그대로 보여 준다 (%#)", async (result, message) => {
      const s = server({ avatar_url: null, revision: null });
      await open(); await click("이모지"); await click("벚꽃");
      s.current = { avatar_url: "🌸", revision: NEW }; s.puts.push(async () => result.clone());
      await click("저장");
      expect(reads()).toBe(1);
      expect(alertText()).toBe(message);
      expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
    });

    it("서버 값이 그대로면 저장됐다고도, 바뀌었다고도 말하지 않는다", async () => {
      const s = server({ avatar_url: "🌷", revision: OLD });
      await open(); await click("벚꽃");
      s.puts.push(async () => response({ code: "AVATAR_SAVE_FAILED" }, 503));
      await click("저장");
      expect(alertText()).toBe("프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      expect(button("벚꽃").getAttribute("aria-pressed")).toBe("true");
      expect(button("저장").disabled).toBe(false);
    });

    it("다시 읽는 사이 계정이 바뀌면 아무것도 반영하지 않는다", async () => {
      let finishRead!: (value: Response) => void;
      let getCount = 0;
      fetchMock.mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") throw abort();
        getCount += 1;
        return getCount === 1 ? response({ avatar_url: null, revision: null }) : new Promise<Response>((resolve) => { finishRead = resolve; });
      });
      await open(); await click("이모지"); await click("벚꽃"); await click("저장");
      const other = { ...profile, id: "33333333-3333-4333-8333-333333333333", name: "다른 계정" };
      await act(async () => useAuthStore.setState({ user: { id: other.id, email: "other@example.invalid" }, profile: other }));
      await act(async () => finishRead(response({ avatar_url: "🐱", revision: NEW })));
      expect(useAuthStore.getState().profile).toEqual(other);
      expect(container.textContent).not.toContain("저장했어요");
      expect(container.textContent).not.toContain("바뀌었어요");
    });

    it("저장 요청이 서버에 닿기 전에 멈춘 오류는 다시 읽지 않는다", async () => {
      const s = server({ avatar_url: null, revision: null });
      await open(); await click("이모지"); await click("벚꽃");
      s.puts.push(async () => { throw new Error("not a transport failure"); });
      await click("저장");
      expect(reads()).toBe(1);
      expect(alertText()).toBe("프로필 저장 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    });
  });
  it("지연된 이전 계정의 저장 응답은 새 계정에 반영하지 않는다", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT"
      ? new Promise<Response>((resolve) => { finish = resolve; }) : response({ avatar_url: null, revision: null }));
    await open(); await click("이모지"); await click("저장");
    const other = { ...profile, id: "33333333-3333-4333-8333-333333333333", name: "다른 계정" };
    await act(async () => useAuthStore.setState({ user: { id: other.id, email: "other@example.invalid" }, profile: other }));
    await act(async () => finish(response({ avatar_url: "🌸", revision: REVISION })));
    expect(useAuthStore.getState().profile).toEqual(other);
    expect(container.textContent).not.toContain("저장했어요");
  });

  it.each([response({ error: "failed" }, 503), response({ avatar_url: "javascript:alert(1)", revision: REVISION }), response({ avatar_url: "🌸" })])("실패·잘못된 2xx 응답은 성공으로 표시하지 않고 재시도 선택을 보존한다", async (result) => {
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT" ? result.clone() : response({ avatar_url: null, revision: null }));
    await open(); await click("이모지"); await click("벚꽃"); await click("저장");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("결과를 확인하지 못했어요");
    expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
    expect(button("벚꽃").getAttribute("aria-pressed")).toBe("true");
    expect(button("저장").disabled).toBe(false);
  });

  it("조회 실패 시 저장을 막고 다시 불러올 수 있다", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    await open(); expect(container.textContent).toContain("다시 불러오기");
    expect(container.querySelector('[aria-label="프로필 표시 방식"]')).toBeNull();
    await click("다시 불러오기"); await click("이모지"); expect(writes()).toHaveLength(0);
  });

  it.each([
    { avatar_url: null, revision: null },
    { avatar_url: null, revision: "not-a-revision" },
    { avatar_url: "🌷", revision: REVISION },
  ])("미설정 응답·잘못된 revision·다른 선택 결과는 저장 확인으로 쓰지 않는다", async (result) => {
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT" ? response(result) : response({ avatar_url: null, revision: null }));
    await open(); await click("이모지"); await click("벚꽃"); await click("저장");
    expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("저장했어요");
  });

  it("사진은 단일 photo 파일로 전송하고 확인된 비공개 URL만 저장한다", async () => {
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT" ? response({ avatar_url: PHOTO, revision: REVISION }) : response({ avatar_url: null, revision: null }));
    await open(); await click("사진");
    const file = new File(["mock PNG handled by server"], "avatar.png", { type: "image/png" });
    await chooseFile(file); expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:avatar-test");
    await click("저장");
    const body = writes()[0][1]?.body as FormData;
    expect([...body.keys()]).toEqual(["photo", "expected_revision", "expected_user_id"]); expect(body.get("expected_revision")).toBe("null"); expect(body.get("expected_user_id")).toBe(OWNER); expect(body.get("photo")).toBe(file);
    expect(useAuthStore.getState().profile?.avatar_url).toBe(PHOTO);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-test");
  });

  it("잘못된 형식·크기의 파일은 미리보기나 요청에 쓰지 않는다", async () => {
    await open(); await click("사진");
    await chooseFile(new File(["<svg/>"], "avatar.svg", { type: "image/svg+xml" }));
    expect(container.textContent).toContain("JPG, PNG, WebP 사진을 선택");
    await chooseFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
    expect(container.textContent).toContain("4MB 이하"); expect(createObjectURL).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });

  it("기존 사진에서 기본 글자로 되돌리는 요청은 명시적 초기화다", async () => {
    fetchMock.mockImplementation(async (_input, init) => init?.method === "PUT" ? response({ avatar_url: null, revision: REVISION }) : response({ avatar_url: PHOTO, revision: REVISION }));
    await open(); await click("기본 글자"); await click("저장");
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ kind: "initial", expected_revision: REVISION, expected_user_id: OWNER });
    expect(useAuthStore.getState().profile?.avatar_url).toBeNull();
  });

  it("사진 실패 및 위험한 URL은 같은 한 글자로 돌아오고 새 사진은 다시 표시한다", async () => {
    await act(async () => root.render(<ProfileAvatar name="홍길동" avatarUrl={PHOTO} />));
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector('[data-profile-avatar="initial"]')?.textContent).toBe("홍");
    await act(async () => root.render(<ProfileAvatar name="홍길동" avatarUrl="https://example.invalid/new.webp" />));
    expect(container.querySelector("img")).not.toBeNull();
    for (const avatarUrl of ["javascript:alert(1)", "//example.invalid/photo", "data:image/svg+xml,x", "1"]) {
      await act(async () => root.render(<ProfileAvatar name="홍길동" avatarUrl={avatarUrl} />));
      expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toBe("홍");
    }
  });

  it("체험에서 이모지 변경은 로컬에만 저장한다", async () => {
    useAuthStore.setState({ isDemo: true }); await open(); await click("이모지"); await click("벚꽃"); await click("저장");
    expect(fetchMock).not.toHaveBeenCalled(); expect(useAuthStore.getState().profile?.avatar_url).toBe("🌸");
    expect(container.textContent).toContain("체험 프로필을 바꿨어요");
  });
});
