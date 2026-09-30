import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { V40_COPY, V40_COUPLE_SEND_EXTRA_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, describedByText, labelProblemsIn, type Harness } from "./inputTestKit";
import type { ShareEnv, ShareSentEvent } from "./shareActions";
import { TwoPersonSendBlock } from "./TwoPersonSendBlock";

const URL_BOTH = "https://example.test/wedding-code#v=example&a=first-answers&b=second-answers";

const FORBIDDEN = /궁합|잘 ?맞|안 ?맞|점수|등급|퍼센트|백분율|%|스타일|성격|진단|정확|과학/u;

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface Rendered {
  readonly buildUrl: Mock<() => string | null>;
  readonly onSent: Mock<(event: ShareSentEvent) => void>;
}

async function renderBlock(env?: ShareEnv, buildUrl?: () => string | null): Promise<Rendered> {
  const build = vi.fn<() => string | null>(buildUrl ?? (() => URL_BOTH));
  const onSent = vi.fn<(event: ShareSentEvent) => void>();
  await harness.render(<TwoPersonSendBlock buildUrl={build} onSent={onSent} env={env} idPrefix="t-couple-send" />);
  return { buildUrl: build, onSent };
}

const root = () => harness.container;
const checks = () => [...root().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const textarea = () => root().querySelector<HTMLTextAreaElement>("textarea");
const address = () => root().querySelector<HTMLInputElement>("input[readonly]");
const status = () => root().querySelector<HTMLElement>('[role="status"]');
const statusText = () => status()?.textContent?.trim() ?? "";
const sendButton = () =>
  [...root().querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(V40_COPY.coupleSend.sendButton)) ?? null;

async function checkBoth(): Promise<void> {
  for (const box of checks()) await click(box);
}

async function press(): Promise<void> {
  await click(sendButton());
  await flush();
}

describe("TwoPersonSendBlock: 처음 모양", () => {
  it("제목, 도움말, 체크 둘, 보낼 말, 링크 단추 하나", async () => {
    await renderBlock();
    expect(root().querySelector("h2")?.textContent).toBe(V40_COPY.coupleSend.title);
    expect(root().textContent).toContain(V40_COPY.coupleSend.help);
    expect(checks()).toHaveLength(2);
    expect(checks().map((box) => box.checked)).toEqual([false, false]);
    expect(root().textContent).toContain(V40_COPY.coupleSend.consentAllAnswers);
    expect(root().textContent).toContain(V40_COPY.coupleSend.consentSelf);
    expect(root().querySelector("input[type='radio']")).toBeNull();
    expect(textarea()?.value).toBe(V40_COPY.coupleSend.message);
    expect(root().querySelectorAll("button")).toHaveLength(1);
  });

  it("안내: 가족과 돈 얘기도 읽힘, 누구나 읽고 전달, 되돌릴 수 없음, 예전 링크는 남음, 공유 창", async () => {
    await renderBlock();
    expect(root().textContent).toContain(V40_COPY.coupleSend.sensitiveInfo);
    expect(root().textContent).toContain(V40_COPY.coupleSend.anyoneCanReadInfo);
    expect(root().textContent).toContain(V40_COPY.coupleSend.oldLinksRemainInfo);
    expect(root().textContent).toContain(V40_COPY.send.shareSheetInfo);
  });

  it("도움말이 이 링크를 보내야 상대도 두 사람 결과를 볼 수 있다고 말한다", async () => {
    await renderBlock();
    expect(V40_COPY.coupleSend.help).toContain("이 링크를 보내야 상대도 두 사람 결과를 볼 수 있어요");
    expect(root().textContent).toContain(V40_COPY.coupleSend.help);
  });

  it("둘째 체크는 이 화면의 사람이 지킬 수 있는 약속이다(다른 사람의 동의를 대신 맹세시키지 않는다)", async () => {
    await renderBlock();
    const consent = V40_COPY.coupleSend.consentSelf;
    expect(consent).toBe("이 링크는 상대에게만 보낼게요.");
    expect(consent).not.toContain("동의");
    expect(consent).not.toContain("먼저 답한 사람");
    expect(root().textContent).not.toContain("먼저 답한 사람도");
  });

  it("주소는 누르기 전에 화면에도 부르는 쪽 함수에도 없다", async () => {
    const { buildUrl } = await renderBlock();
    expect(root().innerHTML).not.toContain("example.test");
    expect(buildUrl).not.toHaveBeenCalled();
  });
});

describe("TwoPersonSendBlock: 체크 둘이 모두 켜져야 열린다", () => {
  it("아무것도 안 켰으면 aria-disabled 이고 disabled 속성이 없으며 이유 글이 설명한다", async () => {
    await renderBlock();
    const button = sendButton();
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(root().querySelector("[disabled]")).toBeNull();
    expect(button ? describedByText(button) : "").toBe(V40_COPY.coupleSend.disabledReason);
  });

  it("하나만 켜도 막혀 있다(어느 쪽을 켜도)", async () => {
    await renderBlock();
    await click(checks()[0]);
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("true");
    await click(checks()[0]);
    await click(checks()[1]);
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(root().textContent).toContain(V40_COPY.coupleSend.disabledReason);
  });

  it("둘 다 켜면 열리고 이유 글이 사라진다", async () => {
    await renderBlock();
    await checkBoth();
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("false");
    expect(root().textContent).not.toContain(V40_COPY.coupleSend.disabledReason);
  });

  it("막힌 단추를 누르면 아무것도 보내지 않고 비어 있는 첫 체크로 초점이 간다", async () => {
    const share = vi.fn(async () => undefined);
    const { buildUrl, onSent } = await renderBlock({ share });
    await click(sendButton());
    expect(document.activeElement).toBe(checks()[0]);
    await click(checks()[0]);
    await click(sendButton());
    expect(document.activeElement).toBe(checks()[1]);
    await flush();
    expect(buildUrl).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });
});

describe("TwoPersonSendBlock: 보낸 결과 네 갈래", () => {
  it("공유 창을 마치면 shared", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    const { buildUrl, onSent } = await renderBlock({ share, writeText });
    await checkBoth();
    await press();
    expect(buildUrl).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url: URL_BOTH, text: V40_COPY.coupleSend.message, title: V40_COPY.send.sheetTitle });
    expect(writeText).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith({ kind: "shared" });
    expect(statusText()).toBe(V40_COUPLE_SEND_EXTRA_COPY.sharedSheet);
    expect(address()).toBeNull();
  });

  it("클립보드에 복사하면 copied", async () => {
    const writeText = vi.fn(async () => undefined);
    const { onSent } = await renderBlock({ writeText });
    await checkBoth();
    await press();
    expect(writeText).toHaveBeenCalledWith(`${V40_COPY.coupleSend.message}\n${URL_BOTH}`);
    expect(onSent).toHaveBeenCalledWith({ kind: "copied" });
    expect(statusText()).toBe(V40_COPY.send.copied);
  });

  it("둘 다 안 되면 revealed 이고 읽기 전용 주소 칸에 두 사람의 링크가 열린다", async () => {
    const { onSent } = await renderBlock({});
    await checkBoth();
    await press();
    expect(onSent).toHaveBeenCalledWith({ kind: "revealed" });
    expect(statusText()).toBe(V40_COPY.send.manualCopy);
    expect(address()?.readOnly).toBe(true);
    expect(address()?.value).toBe(URL_BOTH);
    expect(document.activeElement).toBe(address());
  });

  it("공유 창을 닫으면 cancelled: 사건도 주소 칸도 없다", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("닫았어요", "AbortError");
    });
    const { onSent } = await renderBlock({ share });
    await checkBoth();
    await press();
    expect(onSent).not.toHaveBeenCalled();
    expect(statusText()).toBe("");
    expect(address()).toBeNull();
  });

  it("주소를 만들지 못하면 링크를 만들지 못했다고 알린다", async () => {
    const share = vi.fn(async () => undefined);
    const { onSent } = await renderBlock({ share }, () => null);
    await checkBoth();
    await press();
    expect(statusText()).toBe(V40_COPY.send.linkFailed);
    expect(share).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("고쳐 쓴 보낼 말이 그대로 간다", async () => {
    const share = vi.fn(async () => undefined);
    await renderBlock({ share });
    const box = textarea();
    if (!box) throw new Error("보낼 말 칸이 없어요");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "둘이 같이 봐요");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await checkBoth();
    await press();
    expect(share).toHaveBeenCalledWith({ url: URL_BOTH, text: "둘이 같이 봐요", title: V40_COPY.send.sheetTitle });
  });

  it("지금 브라우저의 clipboard 를 부를 때 읽는다", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { onSent } = await renderBlock();
    await checkBoth();
    await press();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ kind: "copied" });
  });
});

describe("TwoPersonSendBlock: 말씨와 라벨", () => {
  it("평가하거나 주장하는 낱말도 고지 문장도 없다", async () => {
    await renderBlock({});
    await checkBoth();
    await press();
    const text = root().textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("번호나 A/B 라벨이 없다", async () => {
    await renderBlock({});
    expect(labelProblemsIn(root())).toEqual([]);
  });

  it("보낼 말에 로마자(내 글자)가 없다", async () => {
    await renderBlock();
    expect(textarea()?.value ?? "").not.toMatch(/[A-Za-z]/u);
  });
});
