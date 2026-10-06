// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoungeWeddingCode from "@/components/app/preparation-style/LoungeWeddingCode";
import {
  WEDDING_CODE_V31_OPTIONS, WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, WEDDING_CODE_V31_VERSION,
  type V31Draft,
} from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { WEDDING_CODE_FUNNEL_DISCLOSURE } from "@/lib/analyticsPrivacy";
import { PAIR_SESSION_RETENTION_DAYS, requestPairSession } from "@/lib/weddingCode/pairSessionContract";
import { createV31Draft, encodeV31, getV31PriorityOptions } from "@/lib/weddingCode/v31";
import { V31_CORE_RATING_IDS, V31_EXTRA_INDEXES } from "@/lib/weddingCode/v31Flow";
import { LOCAL_TTL_MS } from "@/lib/weddingCode/v31LocalProgress";
import { getV31Pages } from "@/lib/weddingCode/v31Pages";
import { getV31StyleLetter } from "@/lib/weddingCode/v31StyleSummary";
import { defaultWeddingCodeEntry } from "./entry";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import WeddingCodeV31Client from "./WeddingCodeV31Client";
import { PairSessionConsent } from "./WeddingCodeV31Connection";
import WeddingCodeTogether from "./together/WeddingCodeTogether";

/**
 * 웨딩코드 v3.1 시작 화면의 문구 시험.
 *
 * 같은 소개가 세 화면에 나온다: 웹 입구(/wedding-code), 앱 라운지(/preparation-style), 초대 화면(/wedding-code/together).
 * 문구의 정본은 WeddingCodeV31Client 한 곳이다. 이 시험은 세 화면을 실제로 그려서 (1) 글이 같은지, (2) 화면이 하는 말이
 * 코드·동의 화면·처리방침이 하는 말과 같은지, (3) 고친 거짓·오해 문장이 되돌아오지 않는지 본다.
 *
 * 기본 진입 판이 v4 로 바뀌면 웹 입구와 라운지는 v4 소개로 가고 초대 화면만 이 소개를 계속 쓴다. 그때는 아래
 * 첫 시험이 빨개지니, 어느 화면이 이 글을 쓰는지부터 다시 정한다.
 */
vi.mock("@/lib/analytics", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/analytics")>(),
  captureWeddingCodeEvent: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/weddingCode/pairSessionContract", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/weddingCode/pairSessionContract")>(),
  requestPairSession: vi.fn(),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = "11111111-1111-4111-8111-111111111111";
const INVITE = "c".repeat(64);
const SURFACES = ["웹 입구", "앱 라운지", "초대 화면"] as const;
type Surface = (typeof SURFACES)[number];

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
/** 처리방침에서 label 로 시작하는 목록 항목 하나(다음 </li> 까지). 다른 판의 항목이 같은 문장을 가져도 이 항목만 본다. */
const policyItem = (label: string) => {
  const policy = source("src/app/privacy/page.tsx");
  const start = policy.indexOf(label);
  expect(start, `처리방침에 「${label}」 항목이 있어야 해요`).toBeGreaterThan(-1);
  return policy.slice(start, policy.indexOf("</li>", start));
};
const INTRO = '[aria-label="웨딩코드 소개"]';

function received(): V31Draft {
  const draft = createV31Draft();
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "skipped" };
  draft.avoidances = { status: "no_preference" }; draft.priorities = { status: "skipped" }; draft.spending = { status: "no_preference" };
  return draft;
}

describe("웨딩코드 v3.1 시작 화면 문구", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.clearAllMocks(); vi.mocked(requestPairSession).mockReset();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); document.body.replaceChildren();
    vi.restoreAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); vi.useRealTimers();
  });

  async function show(surface: Surface) {
    await act(async () => root.unmount()); root = createRoot(container);
    if (surface === "초대 화면") {
      vi.mocked(requestPairSession).mockResolvedValue({ ok: true, snapshot: { roomId: ROOM, state: "waiting", role: "invite", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
      window.history.replaceState(null, "", `/wedding-code/together#room=${ROOM}&invite=${INVITE}`);
      await act(async () => root.render(<WeddingCodeTogether />));
      return;
    }
    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V31_VERSION}`);
    const initialEntry = defaultWeddingCodeEntry(WEDDING_CODE_V31_VERSION);
    expect(initialEntry.kind).toBe("v31");
    await act(async () => root.render(surface === "앱 라운지"
      ? <LoungeWeddingCode shareOrigin="https://hanbang.ai" initialEntry={initialEntry} />
      : <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={initialEntry} />));
  }
  const intro = () => container.querySelector<HTMLElement>(INTRO);
  const introText = () => intro()?.textContent ?? "";
  const privacyBlock = () => container.querySelector<HTMLElement>("[data-intro-privacy]");
  async function click(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) throw new Error("클릭할 HTML 요소가 없어요.");
    await act(async () => element.click());
  }
  async function start() {
    await click([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "내 웨딩코드 시작하기"));
  }

  it("세 화면의 소개 본문이 글자 그대로 같다(정본이 한 곳이다)", async () => {
    const texts: Record<string, string> = {};
    for (const surface of SURFACES) { await show(surface); texts[surface] = introText(); }
    for (const surface of SURFACES) {
      expect(texts[surface], surface).toContain("기본 14페이지 · 로그인 없이 시작");
      expect(texts[surface], surface).toBe(texts["웹 입구"]);
    }
    // 받은 링크에만 붙는 줄과 받은 링크용 제목은 이 세 화면의 소개에 없다.
    expect(texts["웹 입구"]).not.toContain("상대의 답은 이 브라우저에 저장하지 않아요");
    expect(texts["웹 입구"]).toContain("나는 어떤 결혼식을");
  });

  it.each(SURFACES)("%s: 처리방침 링크는 소개 안에 하나이고 새 탭에서 열리며 상대 답이 든 주소를 넘기지 않는다", async surface => {
    await show(surface);
    const links = intro()!.querySelectorAll<HTMLAnchorElement>('a[href="/privacy"]');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("개인정보 처리방침");
    expect(privacyBlock()?.contains(links[0])).toBe(true);
    expect(links[0].getAttribute("target")).toBe("_blank");
    const rel = (links[0].getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    // 링크가 가리키는 /privacy 는 실제 페이지다.
    expect(existsSync(resolve(process.cwd(), "src/app/privacy/page.tsx"))).toBe(true);
  });

  /**
   * 개인정보 안내는 두 겹이다. 시작 버튼 앞에 세 문단을 그대로 펼치면 소개가 12% 길어져 시작 버튼이 1.7화면 아래로 밀렸다.
   * textContent 는 접힌 칸의 글도 포함하므로(다른 시험이 그 덕에 접어도 통과한다) 무엇이 보이고 무엇이 접혀 있는지는 구조로 건다.
   */
  it.each(SURFACES)("%s: 개인정보 안내는 보이는 굵은 한 줄과 접힌 ‘자세히’다(두 사실과 처리방침 링크는 밖에, 세 문단은 안에)", async surface => {
    await show(surface);
    const block = privacyBlock()!;
    const line = block.querySelector<HTMLElement>(":scope > p");
    const fold = block.querySelector<HTMLDetailsElement>(":scope > details");
    expect(line, "보이는 한 줄").not.toBeNull();
    expect(fold, "접힌 칸").not.toBeNull();
    expect(line!.closest("details"), "한 줄은 접힌 칸 밖에 있다").toBeNull();
    // 차례: 보이는 한 줄이 먼저고 접힌 칸이 그 아래다. 둘 다 시작 버튼보다 앞에 있어서 버튼에 닿기 전에 읽힌다.
    expect(line!.compareDocumentPosition(fold!) & Node.DOCUMENT_POSITION_FOLLOWING, "보이는 한 줄이 접힌 칸보다 앞에 있다").toBeTruthy();
    const startButton = [...intro()!.querySelectorAll("button")].find(item => item.textContent?.trim() === "내 웨딩코드 시작하기");
    expect(startButton, "시작 버튼").toBeDefined();
    expect(block.compareDocumentPosition(startButton!) & Node.DOCUMENT_POSITION_FOLLOWING, "개인정보 안내가 시작 버튼보다 앞에 있다").toBeTruthy();
    // 사람들이 먼저 묻는 두 사실(답은 서버에 보내지 않는다, 이용 통계에는 답이 없다)이 굵은 글씨 한 줄 안에 같이 있다.
    const emphasis = line!.querySelector<HTMLElement>("span.font-semibold")?.textContent;
    // 처리방침 제3조는 「화면 개선을 위해 다음만 서비스 이용 통계로 기록합니다」라고 목적을 한정한다. 한 줄도 목적을 빼고 「이용 통계만」이라고 하면 접속 로그 같은 다른 기록이 없다는 말로 읽힌다.
    expect(emphasis).toBe("답하는 동안 고른 답은 서버에 보내지 않고, 화면 개선을 위해서는 답을 뺀 이용 통계만 기록해요.");
    expect(source("src/app/privacy/page.tsx")).toContain("화면 개선을 위해 다음만 서비스 이용 통계로 기록합니다");
    // 처리방침 링크도 이 한 줄 안에 있어 접힌 칸을 열지 않아도 닿는다.
    expect(line!.querySelectorAll('a[href="/privacy"]')).toHaveLength(1);
    expect(line!.textContent).toContain("자세한 내용은 개인정보 처리방침에서 볼 수 있어요.");
    // 접힌 칸: 처음엔 닫혀 있고, 옛 세 문단이 그대로 들어 있으며, 링크는 소개 안에 하나뿐이라 여기엔 없다.
    expect(fold!.querySelector("summary")?.textContent).toBe("자세히");
    // 낭독기 목록에서 세 접힘 중 이름에 대상이 없는 것은 이것뿐이라, 보이는 글자로 시작하는 이름에 무엇을 여는지 덧붙인다.
    expect(fold!.querySelector("summary")?.getAttribute("aria-label")).toBe("자세히, 개인정보 안내");
    expect(fold!.open).toBe(false);
    expect(fold!.querySelectorAll(":scope > div > p")).toHaveLength(3);
    expect(fold!.querySelector("a")).toBeNull();
    const folded = fold!.textContent ?? "";
    const funnel = WEDDING_CODE_FUNNEL_DISCLOSURE;
    for (const sentence of [
      "고른 답과 웨딩코드는 답하는 동안 서버나 계정에 보내지 않아요.",
      `화면 개선을 위해 ${[funnel.wedding_code_intro_viewed, funnel.wedding_code_scene_reached, funnel.wedding_code_completed, funnel.answered_count].join(", ")} 같은 이용 통계만 기록하고, 이 통계에 고른 답·웨딩코드·공유 링크 주소는 넣지 않아요.`,
      `내 답은 이 브라우저에 자동으로 저장돼요. 마지막으로 저장한 날부터 ${LOCAL_TTL_MS / 86_400_000}일 동안 이어 할 수 있어요.`,
      "공용 기기에서는 시작하기 전에 아래 ‘자동 저장 설정’에서 꺼 주세요.",
      "결과에서 ‘함께 보기’에 동의하면 내 답 전체를 서버에 보관하고, 초대로 연결된 상대에게 보여줘요.",
      `초대 후 ${PAIR_SESSION_RETENTION_DAYS}일 동안 볼 수 있고, 만료된 내용은 하루 안에 삭제해요.`,
      "상대가 이미 읽거나 따로 보관한 내용은 회수할 수 없어요.",
    ]) expect(folded, sentence).toContain(sentence);
    // 옛 첫 문단 끝의 안내 문장은 보이는 한 줄로 올라왔으니 두 번 나오지 않는다. 한 줄에는 접힌 칸의 세부를 섞지 않는다.
    expect(block.textContent!.match(/자세한 내용은/g)).toHaveLength(1);
    for (const detail of ["30일", "공용 기기", "보관", "회수"]) expect(line!.textContent, detail).not.toContain(detail);
  });

  it.each(SURFACES)("%s: 공용 기기 안내는 접힌 칸 말고도 시작 버튼 아래 저장 줄에 보이고, 그 줄이 가리키는 ‘자동 저장 설정’이 바로 아래에 있다", async surface => {
    await show(surface);
    const aside = container.querySelector<HTMLElement>('aside[aria-label="이 브라우저의 답 저장"]');
    const line = aside?.querySelector<HTMLElement>('[role="status"]');
    expect(line?.textContent).toBe("답하면 이 브라우저에 자동으로 저장돼요. 공용 기기라면 아래 ‘자동 저장 설정’에서 꺼 주세요.");
    expect(line!.closest("details"), "저장 줄은 접힌 칸 밖에 있다").toBeNull();
    const settings = [...aside!.querySelectorAll("summary")].find(item => item.textContent === "자동 저장 설정");
    expect(settings, "저장 줄이 가리키는 ‘자동 저장 설정’").toBeDefined();
    expect(line!.compareDocumentPosition(settings!) & Node.DOCUMENT_POSITION_FOLLOWING, "‘자동 저장 설정’은 저장 줄보다 아래에 있다").toBeTruthy();
    const startButton = [...intro()!.querySelectorAll("button")].find(item => item.textContent?.trim() === "내 웨딩코드 시작하기")!;
    expect(startButton.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING, "저장 줄은 시작 버튼 아래에 있다").toBeTruthy();
  });

  it.each(SURFACES)("%s: 판정이 아니라는 말은 제목 바로 아래 첫 문단에 한 번 있고 범위 줄과 접힌 칸에는 없다", async surface => {
    await show(surface);
    const lede = intro()!.querySelector<HTMLElement>("h1 + p");
    expect(lede?.textContent).toBe("취향부터 돈을 쓰는 기준, 함께 준비하는 방식까지. 내가 고른 답을 모아 준비 기준으로 정리해 봐요. 성격을 진단하는 검사가 아니에요.");
    expect(lede!.closest("details")).toBeNull();
    expect(container.querySelector("[data-intro-scope]")?.textContent).not.toContain("성격을 진단하는 검사");
    expect(privacyBlock()!.textContent).not.toContain("성격을 진단하는 검사");
    // 이 말은 시작 버튼 위에 이미 보인다: 첫 문단은 시작 버튼보다 앞에 있다.
    const startButton = [...intro()!.querySelectorAll("button")].find(item => item.textContent?.trim() === "내 웨딩코드 시작하기")!;
    expect(lede!.compareDocumentPosition(startButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(SURFACES)("%s: 고른 답·웨딩코드는 서버로 가지 않는다고 하고, 이용 통계는 처리방침과 같은 말로 밝힌다", async surface => {
    await show(surface);
    const text = privacyBlock()?.textContent ?? "";
    expect(text).toContain("고른 답과 웨딩코드는 답하는 동안 서버나 계정에 보내지 않아요.");
    const funnel = WEDDING_CODE_FUNNEL_DISCLOSURE;
    // 화면 → 이용 통계 표(analyticsPrivacy.ts) → 처리방침 제3조 가 같은 어구로 이어진다.
    // 답과 가장 가까운 항목은 답한 수·건너뛴 수(끝까지 했을 때 함께 간다)라서 빼지 않고 처리방침의 말 그대로 적는다.
    expect(funnel.skipped_count, "답한 수와 건너뛴 수는 방침에서 한 어구로 묶여 있다").toBe(funnel.answered_count);
    const phrases = [funnel.wedding_code_intro_viewed, funnel.wedding_code_scene_reached, funnel.wedding_code_completed, funnel.answered_count];
    expect(text).toContain(`화면 개선을 위해 ${phrases.join(", ")} 같은 이용 통계만 기록하고, 이 통계에 고른 답·웨딩코드·공유 링크 주소는 넣지 않아요.`);
    const policy = source("src/app/privacy/page.tsx");
    for (const phrase of phrases) expect(policy, phrase).toContain(phrase);
    expect(policy).toContain("화면 개선을 위해 다음만 서비스 이용 통계로 기록합니다");
    expect(policy).toContain("고른 답·웨딩코드·공유 링크 주소는 이 통계에 넣지 않습니다");
  });

  it("이용 통계는 소개를 연 순간부터 나가고, 보내는 값에 답 본문이 없다(그래서 ‘서버에 보내지 않아요’는 답과 코드에만 한 말이다)", async () => {
    await show("웹 입구");
    const calls = vi.mocked(captureWeddingCodeEvent).mock.calls;
    expect(calls.map(([name]) => name)).toContain("wedding_code_intro_viewed");
    const [, properties] = calls.find(([name]) => name === "wedding_code_intro_viewed")!;
    expect(Object.keys(properties ?? {}).sort()).toEqual(["has_partner_link", "placement", "scene_total", "version"]);
    expect(properties).toMatchObject({ version: WEDDING_CODE_V31_VERSION, has_partner_link: false });
  });

  it.each(SURFACES)("%s: 함께 보기 보관 안내는 동의 화면·처리방침과 같은 사실만 말한다", async surface => {
    await show(surface);
    const text = privacyBlock()?.textContent ?? "";
    const consent = document.createElement("div"); document.body.appendChild(consent);
    const consentRoot = createRoot(consent);
    await act(async () => consentRoot.render(<PairSessionConsent consent={false} ageConfirmed={false} disabled={false} onConsent={() => {}} onAge={() => {}} />));
    const consentText = consent.textContent ?? "";
    await act(async () => consentRoot.unmount()); consent.remove();
    const retention = `초대 후 ${PAIR_SESSION_RETENTION_DAYS}일 동안 볼 수 있고, 만료된 내용은 하루 안에 삭제해요.`;
    for (const [where, value] of [["소개", text], ["동의 화면", consentText]] as const) {
      expect(value, where).toContain(retention);
      expect(value, where).toContain("내 답 전체를 서버에 보관");
      expect(value, where).toContain("‘연결 끝내기’를 누르면 두 사람의 공유 답을 바로 지");
    }
    // 이 글은 초대한 사람도, 초대 링크를 먼저 쓴 사람(초대 화면에서 답하는 사람)도 읽는다. 누가 읽어도 맞게 ‘초대로 연결된 상대’로 쓴다.
    expect(text).toContain("결과에서 ‘함께 보기’에 동의하면 내 답 전체를 서버에 보관하고, 초대로 연결된 상대에게 보여줘요.");
    expect(consentText).toContain("초대로 연결된 상대에게 보여주는 데 동의해요");
    for (const [where, value] of [["소개", text], ["동의 화면", consentText]] as const) expect(value, where).toContain("초대 링크를 먼저 사용한 사람이 상대가 돼요.");
    expect(text).toContain("이름이나 계정으로는 확인하지 않아요.");
    expect(text).toContain("상대가 이미 읽거나 따로 보관한 내용은 회수할 수 없어요.");
    const policy = source("src/app/privacy/page.tsx");
    expect(policy).toContain("초대 링크를 먼저 사용해 동의한 사람이 상대가 됩니다");
    expect(policy).toContain("만료 즉시 접근을 막고 하루 안에 기록을 삭제합니다");
    expect(policy).toContain("이미 상대가 읽거나 따로 보관한 내용은 회수할 수 없습니다");
    // 옛 문장은 7일만 말하고 무엇을 보관하는지, 누가 읽는지, 언제 지우는지를 빼 먹었다.
    expect(text).not.toContain("선택한 답을 7일간");
    // 먼저 쓴 사람에게 ‘보여준다’는 말은 초대한 사람에게만 맞다. 초대 화면에서는 읽는 사람이 바로 그 사람이다.
    expect(text).not.toContain("초대 링크를 먼저 사용해 동의한 사람에게");
    // ‘이미 본 내용’은 따로 보관한 사본(캡처 같은 것)을 빼서 방침보다 약하다.
    expect(text).not.toContain("상대가 이미 본 내용");
  });

  it.each(SURFACES)("%s: 이 브라우저 저장 기간은 코드가 읽는 기간이고, 공용 기기는 시작하기 전에 끄라고 한다", async surface => {
    await show(surface);
    const text = privacyBlock()?.textContent ?? "";
    expect(LOCAL_TTL_MS / 86_400_000).toBe(30);
    expect(text).toContain(`내 답은 이 브라우저에 자동으로 저장돼요. 마지막으로 저장한 날부터 ${LOCAL_TTL_MS / 86_400_000}일 동안 이어 할 수 있어요.`);
    expect(text).toContain("공용 기기에서는 시작하기 전에 아래 ‘자동 저장 설정’에서 꺼 주세요.");
    // 처리방침의 v3.1 이어하기 항목도 같은 30일을 말한다. 방침 전체에서 찾으면 v4 항목의 같은 문장이 대신 통과시킨다.
    expect(policyItem("이전 웨딩코드(v3.1) 이어하기:")).toContain("마지막으로 답이나 진행을 저장한 때부터 30일 동안");
    // 안내가 가리키는 ‘자동 저장 설정’이 실제로 소개 화면에 있다.
    expect([...intro()!.querySelectorAll("summary")].map(item => item.textContent)).toContain("자동 저장 설정");
  });

  it("보이는 숫자는 사용자가 실제로 지나가는 흐름과 같다: 기본 14페이지, 문장은 한 페이지에 최대 3개씩, 선택 질문 8개", async () => {
    await show("웹 입구");
    const text = introText();
    const pages = getV31Pages("core");
    expect(text).toContain(`기본 ${pages.length}페이지 · 로그인 없이 시작`);
    expect(text).toContain(`${V31_CORE_RATING_IDS.length}개 문장에 다섯 단계로 답하고, ${WEDDING_CODE_V31_TASTES.length}가지 취향과 피하고 싶은 것`);
    expect(text).toContain(`결과에서 ${V31_EXTRA_INDEXES.length}개 선택 질문을 이어서 볼 수 있어요`);
    expect(text).toContain("문장은 한 페이지에 최대 3개씩, 나머지는 한 페이지에 하나씩 물어봐요");
    // 선택 질문 8개는 3, 3, 2개로 묶인다. 그래서 ‘3개씩’이 아니라 ‘최대 3개씩’이 맞다.
    expect(getV31Pages("extra").map(page => page.length)).toEqual([3, 3, 2]);
    expect(text).not.toContain("한 페이지에 3개씩");
    // 문장 15개는 3개씩 5페이지, 나머지 9페이지는 하나씩이라 14페이지다.
    const sentencePages = pages.filter(page => page.every(index => index < WEDDING_CODE_V31_QUESTIONS.length));
    expect(sentencePages.map(page => page.length)).toEqual([3, 3, 3, 3, 3]);
    expect(pages.slice(sentencePages.length).every(page => page.length === 1)).toBe(true);
    // 질문 화면이 실제로 같은 수를 센다.
    await start();
    expect(container.querySelector("progress")?.getAttribute("max")).toBe(String(pages.length));
    expect(container.querySelectorAll("[data-question]")).toHaveLength(3);
    // 이 숫자는 최대치다: 24개(문장 15 + 취향 6 + 세 질문)나 23개로 말하지 않는다.
    expect(text).not.toContain("기본 24개");
    expect(text).not.toMatch(/기본 2[34]개/);
  });

  it("마지막 ‘꼭 지키고 싶은 것’ 페이지의 조건은 실제 보기 규칙과 같다", async () => {
    await show("웹 입구");
    const paragraph = container.querySelector("[data-intro-priority]")?.textContent ?? "";
    // 소개가 인용하는 두 보기 이름은 다섯 단계의 4점·5점 이름이다.
    const four = WEDDING_CODE_V31_OPTIONS.find(option => option.value === 4)!.label;
    const five = WEDDING_CODE_V31_OPTIONS.find(option => option.value === 5)!.label;
    expect(paragraph).toContain(`‘${four}’나 ‘${five}’로 답한 문장, 직접 고른 취향, 피하고 싶은 것이 보기로 나와요.`);
    expect(paragraph).toContain("고르지 않고 넘어가도 결과를 볼 수 있어요");
    // 더 쓰고 싶은 곳은 이 페이지의 보기가 아니다.
    expect(paragraph).not.toContain("더 쓰고 싶은 곳");
    const draft = createV31Draft();
    draft.answers = { G1: 4, G3: 5, R4: 3, B1: "undecided", B3: 2 };
    draft.tastes = { venue: { status: "answered", values: ["indoor"] }, photo: { status: "no_preference" }, meal: { status: "undecided" } };
    draft.avoidances = { status: "answered", values: ["loud_music"] };
    draft.spending = { status: "answered", values: ["venue"] };
    expect(getV31PriorityOptions(draft).map(option => option.value)).toEqual(["G1", "G3", "taste.venue", "avoid.loud_music"]);
    // 보기가 하나도 없으면 이 페이지를 건너뛴다. 소개도 ‘고를 것이 없으면 건너뛰어요’라고 말한다.
    expect(getV31PriorityOptions(createV31Draft())).toEqual([]);
    expect(introText()).toContain("마지막 ‘꼭 지키고 싶은 것’ 페이지는 고를 것이 없으면 건너뛰어요.");
  });

  it("‘?’ 설명은 실제 글자 규칙과 보기 이름과 같다", async () => {
    await show("웹 입구");
    const text = introText();
    expect(text).toContain("아직 모르거나 이번 계획에 없는 내용은 ‘아직 모르겠어요’ 같은 보기로 따로 표시해도 괜찮아요. 네 글자를 정하는 문장을 이렇게 표시하면 그 글자는 ‘?’로 남아요.");
    for (const state of ["undecided", "not_applicable", "skipped"] as const) expect(getV31StyleLetter("budget", 4, state), state).toBe("?");
    // 두 문장을 모두 칸으로 골랐을 때만 글자가 생긴다.
    expect(getV31StyleLetter("budget", 4, 4)).not.toBe("?");
    // 소개가 이름을 부른 보기는 첫 질문 화면에 실제로 있다.
    await start();
    const options = [...container.querySelectorAll('[data-question="G1"] details[data-escape-options] label')].map(item => item.textContent?.trim());
    expect(options).toContain("아직 모르겠어요");
    // 접힌 제목 이름(‘답하기 어려워요’)은 보기가 아니라서 소개가 보기처럼 부르지 않는다.
    expect(text).not.toContain("답하기 어려워요");
  });

  it("받은 링크에서만 ‘주소에 상대의 답이 들어 있어 기록에 남을 수 있다’고 알리고, 그 말은 실제 주소에 맞다", async () => {
    const note = "다만 받은 링크 주소에는 상대의 답이 들어 있어서 브라우저 방문 기록에 남을 수 있어요.";
    await act(async () => root.render(<WeddingCodeV31Client shareOrigin="https://hanbang.ai" partnerDraft={received()} />));
    expect(introText()).toContain(note);
    expect(introText()).toContain("상대의 답은 이 브라우저에 저장하지 않아요. 내가 직접 답하거나 불러온 내 답만 저장해요.");
    // 받은 링크의 첫 문단도 판정이 아니라는 말을 한 번만 한다. 앞에 ‘정리해’ 문장이 없어서 ‘정리해서 보여줘요’까지 이어 쓴다.
    expect(container.querySelector("h1 + p")?.textContent).toBe("상대의 답이 담긴 링크를 받았어요. 나도 답하면 함께 원하는 것과 먼저 맞춰볼 부분을 나란히 볼 수 있어요. 성격을 진단하는 검사가 아니에요. 내가 고른 답을 정리해서 보여줘요.");
    expect(introText().match(/아니에요/g)).toHaveLength(1);
    expect(introText().match(/성격|MBTI/g)).toHaveLength(1);
    // 받은 링크 맥락은 처음 그릴 때 정해지므로 새 화면으로 다시 그린다.
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<WeddingCodeV31Client shareOrigin="https://hanbang.ai" />));
    expect(introText()).not.toContain(note);
    // 실제 입구: 받은 링크의 # 뒤에 상대 답이 있고, 소개를 열어도 주소에서 지워지지 않는다.
    const code = encodeV31(received());
    await act(async () => root.unmount()); root = createRoot(container);
    window.history.replaceState(null, "", `/wedding-code#v=v3.1-preferences&a=${code}`);
    await act(async () => root.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    expect(introText()).toContain(note);
    expect(window.location.hash).toContain(`a=${code}`);
  });

  it("부제와 카드는 고른 답을 정리해 보여준다는 말만 하고, 접힌 칸의 목록은 실제 문항과 맞는다", async () => {
    await show("웹 입구");
    const text = introText();
    // 판정이 아니라는 말은 이 정리한다는 말 바로 뒤, 소개 첫 문단에 붙어 있다.
    expect(text).toContain("내가 고른 답을 모아 준비 기준으로 정리해 봐요. 성격을 진단하는 검사가 아니에요.");
    expect(text).toContain("예산·일 나누기·가족·도움, 주제마다 두 문장의 답으로 글자를 하나씩 정하고 문장별 답도 보여줘요.");
    expect(text).toContain("장소·사진·옷·식사·하객 규모·식순에서 내가 고른 것을 모아 봐요.");
    expect(text).toContain("혼자 해도 결과를 볼 수 있고, 둘 다 답하고 서로 공유하면 두 사람의 답을 나란히 볼 수 있어요.");
    const details = [...intro()!.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent === "무엇을 물어보나요?");
    expect(details?.textContent).toContain("초대할 사람과 하객의 이동 시간, 후보를 비교하는 방식, 둘이 일을 나누는 방식, 가족과 상의하는 순서와 마지막 선택, 힘들 때 바라는 도움");
  });

  it("고친 거짓·오해 문장이 화면과 소스에 되돌아오지 않는다", async () => {
    const banned = [
      "답하는 동안에는 서버나 계정에", "선택한 답을 7일간", "예산·분담", "분담", "짧은 문장은", "기본 24개", "기본 질문은 14페이지예요",
      "나만의 준비 기준", "찾아봐요", "함께 비교할 수 있어요", "하객·식순", "둘이 따로 정해", "어디까지 알아볼 수 있나요",
      "혼자 해도 결과를 받고", "상대도 답하면 둘이 고른 답", "혼자 내 결과를 보고, 상대도 답하면", "문장별 동의 정도",
      // 검토에서 고친 말: 글자는 답이 정하는 것이지 붙이는 것이 아니다, 질문 문구와 다른 낱말, 이용 통계 고지가 방침보다 좁았던 말,
      // 초대 화면에서 틀린 보여주는 대상, 방침보다 약한 되돌릴 수 없다는 말.
      "글자를 하나씩 붙이고", "네 글자에 쓰이는", "다른 비용을 줄여서라도", "같은 이용 통계만 남기고",
      "먼저 사용해 동의한 사람에게 보여줘요", "상대가 이미 본 내용", "한 페이지에 3개씩",
      // 결과 화면은 고른 것을 그대로 정리할 뿐 취향을 새로 만들어 내지 않는다. ‘구체적인’·‘한눈에’는 그 이상을 약속하는 말이었다.
      "구체적인 취향을 한눈에",
    ];
    for (const surface of SURFACES) {
      await show(surface);
      for (const phrase of banned) expect(introText(), `${surface}: ${phrase}`).not.toContain(phrase);
    }
    // 소개 문구가 들어 있는 다섯 곳의 소스. 조건부로만 그려지는 갈래의 되돌아옴도 잡는다.
    const files = [
      "src/app/wedding-code/WeddingCodeV31Client.tsx", "src/components/app/preparation-style/LoungeWeddingCode.tsx",
      "src/app/wedding-code/together/WeddingCodeTogether.tsx", "src/app/wedding-code/opengraph-image.tsx", "src/app/wedding-code/page.tsx",
    ];
    for (const file of files) {
      const text = source(file);
      for (const phrase of banned) expect(text, `${file}: ${phrase}`).not.toContain(phrase);
    }
    expect(source("src/app/wedding-code/opengraph-image.tsx")).not.toContain("상대도 답하면");
    expect(source("src/app/wedding-code/page.tsx")).not.toContain("상대도 답하면");
  });

  it.each(SURFACES)("%s: 말투 규칙을 지킨다(줄표 없음, 겹친 부정 없음, 이 기기 없음, 답이라는 한 낱말)", async surface => {
    await show(surface);
    const text = introText();
    expect(text, "긴 줄표·짧은 줄표·비슷한 모양").not.toMatch(/[‐-―−－]/);
    for (const banned of ["뜻은 아니에요", "뿐 아니라", "이 기기", "검증", "점수"]) expect(text, banned).not.toContain(banned);
    // 판정이 아니라는 말은 소개 첫 문단에서 한 번만 한다.
    expect(text.match(/아니에요/g)).toHaveLength(1);
    expect(text.match(/성격|MBTI/g)).toHaveLength(1);
    // 저장된 것을 ‘진행’이나 ‘선택’이 아니라 ‘답’이라고 부른다(처리방침, 지우기 버튼 이름과 같은 말).
    expect(text).toContain("내 답은 이 브라우저에 자동으로 저장돼요");
    expect(text).not.toMatch(/저장된 진행|진행 상황을 저장/);
  });
});
