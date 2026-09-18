import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 15초 후기는 `POST /api/community/posts` 가 요구하는 모양으로 보내야 저장된다.
//   - `Idempotency-Key` 헤더(UUID). 없으면 본문을 읽기 전에 400 COMMUNITY_POST_IDEMPOTENCY_REQUIRED.
//   - `vendor_tags` 는 등록된 업체의 UUID 만. 적은 업체 이름을 넣으면 저장 RPC 가
//     COMMUNITY_POST_PAYLOAD_INVALID 로 거절한다(`20260804200000_community_post_service_write_boundary.sql`).
//   - 「협찬」은 협찬 내용 5자 이상.
// 예전 화면은 앞의 둘을 어겨 후기가 한 건도 저장되지 않았다.

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock("@/components/community/Toast", () => ({
  useToast: () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }),
}));

vi.mock("@/components/community/ImageUploader", () => ({
  default: () => null,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (select: (state: { profile: { id: string } }) => unknown) =>
    select({ profile: { id: "11111111-1111-4111-8111-111111111111" } }),
}));

import QuickReviewPage from "../page";
import { communityPostPath } from "@/lib/community/routes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POST_ID = "22222222-2222-4222-8222-222222222222";

type FetchCall = { url: string; headers: Headers; body: Record<string, unknown> };

let container: HTMLDivElement;
let root: Root;
let fetchCalls: FetchCall[];
let respond: () => Promise<Response>;

function receipt(postId: string | null = POST_ID) {
  return new Response(
    JSON.stringify({
      post: postId === null ? {} : { id: postId, author_id: "11111111-1111-4111-8111-111111111111" },
      poll_id: null,
      post_count: 1,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
  expect(found, `button "${text}"`).toBeTruthy();
  return found!;
}

async function typeInto(placeholderStart: string, value: string) {
  const input = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ).find((element) => element.placeholder.startsWith(placeholderStart));
  expect(input, `field "${placeholderStart}"`).toBeTruthy();
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseCategory(value: string) {
  const select = container.querySelector("select");
  expect(select).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await flush();
}

async function fillReview({
  vendor = "라벨르 스튜디오",
  category = "dress",
  stars = 4,
  review = "실장님이 친절하고 드레스 종류도 많았어요",
} = {}) {
  await typeInto("예: 라벨르", vendor);
  await chooseCategory(category);
  await click(container.querySelector<HTMLButtonElement>(`button[aria-label="${stars}점"]`)!);
  await typeInto("실장님이", review);
}

async function submitAs(disclosure: "일반 글" | "협찬 포함" | "광고", sponsorshipDetail?: string) {
  await click(buttonByText("후기 등록"));
  await click(buttonByText(disclosure));
  if (sponsorshipDetail !== undefined) await typeInto("예: 드레스 입어보기", sponsorshipDetail);
  await click(buttonByText("확인"));
}

describe("15초 후기 저장 요청", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    respond = async () => receipt();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return respond();
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<QuickReviewPage />));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("보내는 요청이 서버 계약을 지킨다 — 요청 키 UUID, 업체 이름은 제목으로만, 고른 카테고리는 tags", async () => {
    await fillReview();
    await submitAs("일반 글");

    expect(fetchCalls).toHaveLength(1);
    const [call] = fetchCalls;
    expect(call!.url).toBe("/api/community/posts");
    // soft: 한 결함이 다른 결함을 가리지 않게 둘 다 보고한다.
    expect.soft(call!.headers.get("idempotency-key")).toEqual(expect.stringMatching(UUID));
    expect.soft(call!.body).toMatchObject({
      category: "tour_review",
      title: "라벨르 스튜디오 후기",
      content: "실장님이 친절하고 드레스 종류도 많았어요",
      visibility: "public",
      is_quick_review: true,
      rating: 4,
      ad_disclosure: "general",
      tags: ["dress"],
      vendor_tags: [],
    });
    expect(call!.body).not.toHaveProperty("sponsorship_detail");
  });

  it("서버가 돌려준 새 글 id 로 이동한 뒤에만 등록됐다고 말한다", async () => {
    await fillReview();
    await submitAs("일반 글");

    expect(mocks.routerPush).toHaveBeenCalledWith(communityPostPath(POST_ID));
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("201 이어도 영수증에 글 id 가 없으면 등록됐다고 말하지 않고 이동하지 않는다", async () => {
    respond = async () => receipt(null);
    await fillReview();
    await submitAs("일반 글");

    expect(fetchCalls).toHaveLength(1);
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("「협찬」은 받은 혜택을 함께 보내고, 5자 미만이면 보내지 않는다", async () => {
    await fillReview();
    await click(buttonByText("후기 등록"));
    await click(buttonByText("협찬 포함"));
    await typeInto("예: 드레스 입어보기", "  무료 ");
    await click(buttonByText("확인"));

    expect(fetchCalls).toHaveLength(0);
    expect(container.textContent).toContain("협찬 내용을 5자 이상 입력해주세요.");

    await typeInto("예: 드레스 입어보기", "  드레스 대여비 1회 지원받음 ");
    await click(buttonByText("확인"));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.headers.get("idempotency-key")).toMatch(UUID);
    expect(fetchCalls[0]!.body).toMatchObject({
      ad_disclosure: "sponsored",
      sponsorship_detail: "드레스 대여비 1회 지원받음",
      vendor_tags: [],
    });
  });

  it("응답을 잃고 같은 내용을 다시 보내면 같은 요청 키를, 내용을 바꾸면 새 키를 쓴다", async () => {
    respond = async () => {
      throw new TypeError("Failed to fetch");
    };
    await fillReview();
    await submitAs("일반 글");
    await submitAs("일반 글");

    expect(fetchCalls).toHaveLength(2);
    const firstKey = fetchCalls[0]!.headers.get("idempotency-key");
    expect(firstKey).toMatch(UUID);
    expect(fetchCalls[1]!.headers.get("idempotency-key")).toBe(firstKey);
    expect(mocks.routerPush).not.toHaveBeenCalled();
    // 네트워크 실패의 영어 원문("Failed to fetch")을 화면에 쓰지 않는다.
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "후기를 올리지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    );

    await typeInto("실장님이", "다시 생각해 보니 상담이 조금 짧았어요");
    respond = async () => receipt();
    await submitAs("일반 글");

    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[2]!.headers.get("idempotency-key")).toMatch(UUID);
    expect(fetchCalls[2]!.headers.get("idempotency-key")).not.toBe(firstKey);
    expect(mocks.routerPush).toHaveBeenCalledWith(communityPostPath(POST_ID));
  });
});
