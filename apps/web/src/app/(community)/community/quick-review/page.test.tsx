import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/community/Toast", () => ({
  useToast: () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }),
}));
vi.mock("@/components/community/ImageUploader", () => ({
  default: () => null,
}));

import QuickReviewPage from "./page";
import { communityPostPath } from "@/lib/community/routes";
import {
  QUICK_REVIEW_CONNECTION_LOST_MESSAGE,
  QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE,
  QUICK_REVIEW_RECEIPT_MISSING_MESSAGE,
} from "./quickReviewSubmission";

/**
 * 웹 15초 후기 화면에서 "후기 등록"을 끝까지 눌러 본다. 광고 표시 모달도 실제 컴포넌트다.
 *
 * 2026-09-19 이 화면은 요청 키 헤더 없이 보내 서버가 본문을 읽기도 전에 400 으로 막았고,
 * 업체 이름을 `vendor_tags` 에 넣어 저장 RPC 의 UUID 검사에도 걸렸다. 한 건도 저장되지 않았다.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POST_ID = "5b0c3d2e-1f4a-4b6c-8d7e-9f0a1b2c3d4e";
const SERVER_SPONSOR_ERROR = "협찬 내용을 5자 이상 입력해주세요.";
const KEYS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];

const created = () => ({
  ok: true,
  status: 201,
  json: async () => ({ post: { id: POST_ID, author_id: "x" }, poll_id: null, post_count: 1 }),
});
const saveFailed = () => ({
  ok: false,
  status: 503,
  json: async () => ({
    code: "COMMUNITY_POST_SAVE_FAILED",
    error: "게시글을 안전하게 저장하지 못했습니다. 같은 내용으로 다시 시도해 주세요.",
  }),
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  const keys = [...KEYS];
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => keys.shift() as ReturnType<typeof globalThis.crypto.randomUUID>,
  );
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  await act(async () => {
    root.render(<QuickReviewPage />);
  });
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null | undefined, what: string) {
  expect(element, `${what} 을(를) 찾지 못했다`).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function input(placeholder: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  expect(found, `입력칸 "${placeholder}" 이 없다`).not.toBeNull();
  return found!;
}

async function fill({ review = "실장님이 친절해요" }: { review?: string } = {}) {
  await type(input("예: 라벨르 스튜디오"), "라벨르 스튜디오");
  await click(container.querySelector('button[aria-label="4점"]'), "별 4개");
  await type(input("실장님이 친절해요. 드레스 종류도 많고..."), review);
}

function categorySelect(): HTMLSelectElement {
  const found = container.querySelector("select");
  expect(found, "카테고리 선택칸이 없다").not.toBeNull();
  return found!;
}

async function chooseCategory(value: string) {
  const select = categorySelect();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function confirmButton() {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "확인");
}

/** "후기 등록"을 누르고 광고 표시 모달에서 유형을 고른 뒤 "확인"까지. */
async function submitAs(label: "일반 글" | "협찬 포함" | "광고", detail?: string) {
  await click(container.querySelector('button[type="submit"]'), "후기 등록 버튼");
  const option = Array.from(container.querySelectorAll("button"))
    .find((button) => button.querySelector("span")?.textContent === label);
  await click(option, `광고 표시 "${label}"`);
  if (detail !== undefined) {
    const textarea = container.querySelector("textarea");
    expect(textarea, "협찬을 골랐는데 협찬 내용을 적을 곳이 없다").not.toBeNull();
    await type(textarea!, detail);
  }
  await click(
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "확인"),
    "모달 확인 버튼",
  );
  await settle();
}

function sent(index: number) {
  const call = fetchMock.mock.calls[index];
  expect(call, `${index + 1}번째 요청이 없다`).toBeTruthy();
  const [url, init] = call as [string, RequestInit];
  const headers = new Headers(init.headers);
  return {
    url,
    method: init.method,
    key: headers.get("idempotency-key"),
    raw: String(init.body),
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

describe("웹 15초 후기 제출", () => {
  it("요청 키 헤더를 싣고, 업체 이름은 제목에만 넣는다", async () => {
    fetchMock.mockResolvedValue(created());
    await mount();
    await fill();
    await submitAs("일반 글");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = sent(0);
    expect(request.url).toBe("/api/community/posts");
    expect(request.method).toBe("POST");
    expect(request.key ?? "", "요청 키가 없으면 서버는 본문을 읽기도 전에 400 이다").toMatch(UUID);
    expect(request.body).toStrictEqual({
      category: "tour_review",
      title: "라벨르 스튜디오 후기",
      content: "실장님이 친절해요",
      images: [],
      visibility: "public",
      vendor_tags: [],
      tags: ["studio"],
      is_quick_review: true,
      rating: 4,
      ad_disclosure: "general",
    });
    expect(request.raw.split("라벨르 스튜디오").length - 1, "업체 이름은 제목에 한 번만").toBe(1);

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });

  it("실패 뒤 같은 내용으로 다시 보내면 같은 키, 내용을 고치면 새 키", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(saveFailed())
      .mockResolvedValueOnce(created());
    await mount();
    await fill();

    await submitAs("일반 글");
    expect(mocks.push, "실패했는데 글로 이동하지 않는다").not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    await submitAs("일반 글");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0).key ?? "").toMatch(UUID);
    expect(sent(1).key, "같은 내용의 재시도가 글을 두 번 만들지 않는다").toBe(sent(0).key);
    expect(sent(1).raw).toBe(sent(0).raw);
    expect(mocks.push).not.toHaveBeenCalled();

    await type(input("실장님이 친절해요. 드레스 종류도 많고..."), "실장님이 친절해요. 주차가 편해요");
    await submitAs("일반 글");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sent(2).key ?? "").toMatch(UUID);
    expect(sent(2).key, "내용이 바뀌면 새 요청이다").not.toBe(sent(0).key);
    expect(sent(2).body.content).toBe("실장님이 친절해요. 주차가 편해요");
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });

  it("고쳤다가 되돌려 보내면 처음 키로 간다. 응답을 잃은 첫 후기가 두 번 생기지 않는다", async () => {
    // 2026-09-19 리뷰: 화면이 마지막 본문 하나만 기억해, 되돌린 본문이 새 키를 받았다(실제 SQL 로 중복 글).
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(created());
    await mount();
    await fill();
    await submitAs("일반 글");

    await type(input("실장님이 친절해요. 드레스 종류도 많고..."), "실장님이 친절해요. 주차가 편해요");
    await submitAs("일반 글");
    await type(input("실장님이 친절해요. 드레스 종류도 많고..."), "실장님이 친절해요");
    await submitAs("일반 글");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sent(1).key, "다른 본문은 다른 요청이다").not.toBe(sent(0).key);
    expect(sent(2).raw).toBe(sent(0).raw);
    expect(sent(2).key, "되돌린 본문이 새 키를 받으면 서버는 새 글을 만든다").toBe(sent(0).key);
    expect(mocks.toastError.mock.calls).toStrictEqual([
      [QUICK_REVIEW_CONNECTION_LOST_MESSAGE],
      [QUICK_REVIEW_CONNECTION_LOST_MESSAGE],
    ]);
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });

  it("협찬은 5자 이상이어야 보내고, 서버와 앱과 같은 문구로 알린다", async () => {
    fetchMock.mockResolvedValue(created());
    await mount();
    await fill();

    await submitAs("협찬 포함", "무료");
    expect(fetchMock, "서버가 거절할 요청을 보내지 않는다").not.toHaveBeenCalled();
    expect(container.textContent).toContain(SERVER_SPONSOR_ERROR);

    await type(container.querySelector("textarea")!, "  드레스 대여비 1회 제공  ");
    await click(
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "확인"),
      "모달 확인 버튼",
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = sent(0);
    expect(request.key ?? "").toMatch(UUID);
    expect(request.body.ad_disclosure).toBe("sponsored");
    expect(request.body.sponsorship_detail).toBe("드레스 대여비 1회 제공");
    expect(request.body.vendor_tags).toStrictEqual([]);
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });
});

describe("협찬 후기를 다시 보낼 때", () => {
  /**
   * 2026-09-19 리뷰: 광고 표시 모달이 고른 것을 자기 안에만 들고 있어서, 실패 뒤 다시 열면
   * 비어 있었다. 협찬 내용을 조금이라도 다르게 다시 적으면 본문이 달라져 새 요청 키가 붙고,
   * 첫 요청이 응답만 잃고 저장된 경우 협찬 후기가 두 개 생겼다(실제 SQL 로 2행 확인).
   */
  it("고른 표시와 협찬 내용이 남아 있고, 확인만 누르면 같은 키로 같은 본문이 간다", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(created());
    await mount();
    await fill();
    await submitAs("협찬 포함", "드레스 대여비 1회 제공받음");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();

    await click(container.querySelector('button[type="submit"]'), "후기 등록 버튼");
    const textarea = container.querySelector("textarea");
    expect(textarea, "다시 열린 모달에 협찬이 골라져 있지 않다").not.toBeNull();
    expect(textarea!.value, "적었던 협찬 내용이 사라졌다").toBe("드레스 대여비 1회 제공받음");
    await click(confirmButton(), "모달 확인 버튼");
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0).key ?? "").toMatch(UUID);
    expect(sent(1).key, "같은 협찬 후기의 재시도가 새 글이 되지 않는다").toBe(sent(0).key);
    expect(sent(1).raw, "본문이 한 글자라도 다르면 서버는 다른 요청으로 본다").toBe(sent(0).raw);
    expect(sent(1).body.sponsorship_detail).toBe("드레스 대여비 1회 제공받음");
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));

    // 저장이 끝나면 고른 표시도 버린다. 다음 후기는 다시 골라야 한다.
    await click(container.querySelector('button[type="submit"]'), "후기 등록 버튼");
    expect(container.querySelector("textarea"), "저장 뒤에도 지난 협찬이 골라져 있다").toBeNull();
    await click(confirmButton(), "모달 확인 버튼");
    await settle();
    expect(container.textContent).toContain("유형을 선택해주세요.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("협찬이 아닌 표시도 실패 뒤 다시 열면 남아 있어 확인만 누르면 된다", async () => {
    fetchMock
      .mockResolvedValueOnce(saveFailed())
      .mockResolvedValueOnce(created());
    await mount();
    await fill();
    await submitAs("광고");

    await click(container.querySelector('button[type="submit"]'), "후기 등록 버튼");
    await click(confirmButton(), "모달 확인 버튼");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(1).key).toBe(sent(0).key);
    expect(sent(1).raw).toBe(sent(0).raw);
    expect(sent(1).body.ad_disclosure).toBe("ad");
  });
});

describe("15초 후기 실패 문구", () => {
  it("연결이 끊기면 영어 오류 대신, 이 화면에서 다시 보내도 두 번 올라가지 않는다고 말한다", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await mount();
    await fill();
    await submitAs("일반 글");
    expect(mocks.toastError.mock.calls).toStrictEqual([[QUICK_REVIEW_CONNECTION_LOST_MESSAGE]]);
    expect(input("예: 라벨르 스튜디오").value, "쓴 내용은 그대로 둔다").toBe("라벨르 스튜디오");
  });

  it("JSON 이 아닌 오류 페이지(504)는 저장됐는지 모른다고 말하고, 다시 보내면 같은 키다", async () => {
    // 게이트웨이는 응답했으니 연결이 끊긴 것은 아니다. 함수는 저장을 끝냈을 수도 있다.
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => JSON.parse("An error occurred with your deployment"),
      })
      .mockResolvedValueOnce(created());
    await mount();
    await fill();
    await submitAs("일반 글");
    expect(mocks.toastError.mock.calls).toStrictEqual([[QUICK_REVIEW_RECEIPT_MISSING_MESSAGE]]);

    await submitAs("일반 글");
    expect(sent(1).key).toBe(sent(0).key);
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });

  it("서버가 한국어 문장을 주면 그 문장을 그대로 보여 준다", async () => {
    fetchMock.mockResolvedValueOnce(saveFailed());
    await mount();
    await fill();
    await submitAs("일반 글");
    expect(mocks.toastError.mock.calls).toStrictEqual([
      ["게시글을 안전하게 저장하지 못했습니다. 같은 내용으로 다시 시도해 주세요."],
    ]);
  });

  it("서버 문장에 한글이 없으면(403 \"Forbidden\") 영어를 보이지 않는다", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
    await mount();
    await fill();
    await submitAs("일반 글");
    expect(mocks.toastError.mock.calls).toStrictEqual([[QUICK_REVIEW_RECEIPT_MISSING_MESSAGE]]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("201 인데 새 글 id 가 없으면 등록됐다고 말하지 않고, 다시 보내면 같은 키다", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ post: null, poll_id: null }) })
      .mockResolvedValueOnce(created());
    await mount();
    await fill();
    await submitAs("일반 글");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastError.mock.calls).toStrictEqual([[QUICK_REVIEW_RECEIPT_MISSING_MESSAGE]]);

    // 저장됐을 수 있으므로 키를 버리지 않는다. 서버가 저장된 글을 돌려준다.
    await submitAs("일반 글");
    expect(sent(1).key).toBe(sent(0).key);
    expect(sent(1).raw).toBe(sent(0).raw);
    expect(mocks.push).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });
});

describe("로그인이 풀린 채 보냈을 때", () => {
  const unauthorized = () => ({ ok: false, status: 401, json: async () => ({ error: "인증이 필요합니다." }) });
  const LOGIN_HREF = "/login?redirect=%2Fwedding%2Fcommunity%2Fquick-review";

  /**
   * 2026-09-19 결정: 쓴 후기를 로그인 너머로 남기지 않는다. 남겨 두면 새 중복 글 경로가 생기고
   * (요청 키 없이 되살아난 초안), 공용 탭에서 다른 계정이 앞사람의 후기를 받고, 조용히 만료됐다.
   * 그래서 이어서 올릴 수 있다고 말하지 않는다.
   */
  it("로그인하면 올릴 수 있다고만 말하고 로그인으로 보낸다. 쓴 내용을 브라우저에 남기지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());
    await mount();
    await fill();
    await chooseCategory("dress");
    await submitAs("일반 글");

    expect(mocks.toastError.mock.calls).toStrictEqual([[QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE]]);
    expect(mocks.push).toHaveBeenCalledWith(LOGIN_HREF);
    expect(window.sessionStorage.length, "sessionStorage 에 남겼다").toBe(0);
    expect(window.localStorage.length, "localStorage 에 남겼다").toBe(0);

    // 로그인하고 돌아온 것처럼 화면을 새로 띄운다. 앞의 내용이 되살아나지 않는다.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(input("예: 라벨르 스튜디오").value).toBe("");
    expect(input("실장님이 친절해요. 드레스 종류도 많고...").value).toBe("");
    expect(categorySelect().value).toBe("studio");
  });

  it("로그아웃 상태 안내의 버튼은 이어서 쓴다고 약속하지 않는다", async () => {
    await mount();
    const link = container.querySelector(`a[href="${LOGIN_HREF}"]`);
    expect(link, "로그인 버튼이 없다").not.toBeNull();
    expect(link!.textContent).toBe("로그인하고 쓰기");
    expect(container.textContent, "로그인하러 다녀오면 쓴 내용은 남지 않는다").not.toContain("이어서");
  });
});
