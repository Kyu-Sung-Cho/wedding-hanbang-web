/**
 * 다시 열었을 때 내 임시저장이 살아 있는가 — 남의 것은 여전히 지워지는가.
 *
 * 커뮤니티 글쓰기는 30초마다 자동 저장하고 "자동 저장됨" 배지를 보여 준다. 그런데
 * 로그인한 채 아무 화면이나 다시 열면 그 저장본이 지워졌다.
 *
 * `communityStore` 에는 `persist` 가 없어 새 문서마다 `viewerId` 가 `null` 로 시작한다.
 * 그래서 `AppClientLayout` 의 `initialize()` → `bindViewer(userId)` 가 늘
 * `null → 내 아이디` 전환이 되고, 그 전환의 purge 가 **내 초안까지** 지웠다.
 * 로그인 사용자에게 복원 기능은 간헐이 아니라 100% 죽어 있었다.
 *
 * 지우는 것 자체는 옳다 — A 가 로그아웃하고 B 가 로그인하면 B 가 A 의 글을 보면 안 된다.
 * 초안 키는 사용자별로 나뉘어 있으므로(`communityPostDraftKey`) **들어오는 사람 자신의
 * 키 하나만** 남기면 그 계약을 지키면서 자기 글을 잃지 않는다.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  communityPostDraftKey,
  purgeCommunityBrowserPrivacyCache,
} from "@/lib/community/viewerPrivacyCache";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const put = (userId: string | null, text: string) =>
  window.localStorage.setItem(
    communityPostDraftKey(userId),
    JSON.stringify({ title: text, content: text, savedAt: Date.now() }),
  );
const get = (userId: string | null) =>
  window.localStorage.getItem(communityPostDraftKey(userId));

describe("다시 열어도 내 임시저장은 남는다", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("앱을 다시 열 때(null → 나) 내 초안이 살아남는다", () => {
    put(A, "예식장 후기 쓰던 중");
    purgeCommunityBrowserPrivacyCache({ preserveViewerId: A });
    expect(get(A)).not.toBeNull();
  });

  it("계정이 바뀌면(A → B) A 의 초안은 지워진다", () => {
    put(A, "A 가 쓰던 글");
    put(B, "B 가 쓰던 글");
    purgeCommunityBrowserPrivacyCache({ preserveViewerId: B });
    // 남의 글이 남으면 그게 유출이다. 이 단언이 이 수정의 경계다.
    expect(get(A)).toBeNull();
    expect(get(B)).not.toBeNull();
  });

  it("로그아웃하면(→ null) 내 초안도 지워진다", () => {
    put(A, "로그아웃 전에 쓰던 글");
    purgeCommunityBrowserPrivacyCache({ preserveViewerId: null });
    expect(get(A)).toBeNull();
  });

  it("데모 뷰어는 남기지 않는다", () => {
    put("demo", "데모로 쓰던 글");
    purgeCommunityBrowserPrivacyCache({ preserveViewerId: "demo" });
    expect(get("demo")).toBeNull();
  });

  it("옵션을 안 주면 예전처럼 전부 지운다", () => {
    put(A, "글");
    put(B, "글");
    purgeCommunityBrowserPrivacyCache();
    expect(get(A)).toBeNull();
    expect(get(B)).toBeNull();
  });

  it("스토어의 bindViewer 를 통해서도 내 초안이 살아남는다", async () => {
    // **배선을 증명한다.** 위 단언들은 purge 함수를 직접 부르므로, 스토어가
    // `preserveViewerId` 를 넘기지 않아도 전부 통과한다 — 변형 검사가 그것을 잡았다.
    // 운영에서 이 경로를 타는 것은 `AppClientLayout` → `initialize()` → `bindViewer` 다.
    const { useCommunityStore } = await import("@/stores/communityStore");
    useCommunityStore.setState({ viewerId: null });
    put(A, "앱을 다시 열기 전에 쓰던 글");
    put(B, "남의 글");
    useCommunityStore.getState().bindViewer(A);
    expect(get(A)).not.toBeNull();
    expect(get(B)).toBeNull();
  });

  it("비로그인 초안 인계는 그대로 동작한다", () => {
    put(null, "로그인 전에 쓰던 글");
    // 상수는 모듈 안에 있어 import 할 수 없다. 값을 지어내면 테스트가 조용히
    // 통과하므로(처음에 그랬다) 소스와 같은 문자열을 쓴다.
    window.sessionStorage.setItem("community:draft-handoff:v1", "guest-login");
    purgeCommunityBrowserPrivacyCache({
      preserveGuestDraftHandoff: true,
      preserveViewerId: A,
    });
    expect(get(null)).not.toBeNull();
  });
});
