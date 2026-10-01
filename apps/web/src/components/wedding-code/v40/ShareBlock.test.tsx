import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { V40_COPY, V40_COUPLE_SEND_EXTRA_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, describedByText, labelProblemsIn, type Harness } from "./inputTestKit";
import type { ShareEnv } from "./shareActions";
import { ShareBlock, type SendOption, type ShareBlockSentEvent } from "./ShareBlock";

const URL_WITH = "https://example.test/wedding-code#v=example&a=with-answers";
const URL_ONLY = "https://example.test/wedding-code?v=example";
const urlFor = (option: SendOption) => (option === "withAnswers" ? URL_WITH : URL_ONLY);

const FORBIDDEN = /궁합|잘 ?맞|안 ?맞|점수|등급|퍼센트|백분율|%|스타일|성격|진단|정확|과학/u;

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
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
  readonly buildUrl: Mock<(option: SendOption) => string | null>;
  readonly onSent: Mock<(event: ShareBlockSentEvent) => void>;
}

async function renderBlock(env?: ShareEnv, buildUrl?: (option: SendOption) => string | null): Promise<Rendered> {
  const build = vi.fn<(option: SendOption) => string | null>(buildUrl ?? urlFor);
  const onSent = vi.fn<(event: ShareBlockSentEvent) => void>();
  await harness.render(<ShareBlock buildUrl={build} onSent={onSent} env={env} idPrefix="t-share" />);
  return { buildUrl: build, onSent };
}

const root = () => harness.container;
const radios = () => [...root().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const consent = () => root().querySelector<HTMLInputElement>('input[type="checkbox"]');
const textarea = () => root().querySelector<HTMLTextAreaElement>("textarea");
const address = () => root().querySelector<HTMLInputElement>("input[readonly]");
const status = () => root().querySelector<HTMLElement>('[role="status"]');
const statusText = () => status()?.textContent?.trim() ?? "";
const sendButton = () =>
  [...root().querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(V40_COPY.send.sendButton)) ?? null;

async function typeInto(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function checkConsent(): Promise<void> {
  await click(consent());
}

async function press(): Promise<void> {
  await click(sendButton());
  await flush();
}

describe("ShareBlock: 처음 모양", () => {
  it("제목, 라디오 둘(첫째가 골라짐), 체크, 보낼 말, 링크 단추 하나", async () => {
    await renderBlock();
    expect(root().querySelector("h2")?.textContent).toBe(V40_COPY.send.title);
    expect(root().querySelector("fieldset legend")?.textContent).toBe(V40_COPY.send.groupLabel);
    expect(radios()).toHaveLength(2);
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
    expect(root().textContent).toContain(V40_COPY.send.withAnswersOption);
    expect(root().textContent).toContain(V40_COPY.send.questionsOnlyOption);
    expect(consent()).not.toBeNull();
    expect(consent()?.checked).toBe(false);
    expect(root().textContent).toContain(V40_COPY.send.consent);
    expect(textarea()?.value).toBe(V40_COPY.send.messageWithAnswers);
    // 링크 단추는 하나뿐이다.
    expect(root().querySelectorAll("button")).toHaveLength(1);
    expect(sendButton()?.textContent).toContain(V40_COPY.send.sendButton);
  });

  it("체크 전에는 단추가 aria-disabled 이고 disabled 속성이 없으며 이유 글이 단추를 설명한다", async () => {
    await renderBlock();
    const button = sendButton();
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(root().querySelector("[disabled]")).toBeNull();
    expect(root().textContent).toContain(V40_COPY.send.disabledReason);
    expect(button ? describedByText(button) : "").toBe(V40_COPY.send.disabledReason);
  });

  it("두 라디오의 도움말이 늘 보이고, 첫째 도움말이 상대가 두 사람 결과 링크를 다시 보내 줘야 한다는 사실을 말한다", async () => {
    await renderBlock();
    const [first, second] = radios();
    expect(describedByText(first)).toBe(V40_COPY.send.withAnswersHelp);
    expect(describedByText(second)).toBe(V40_COPY.send.questionsOnlyHelp);
    // 「그 결과 링크」는 무엇을 가리키는지 알 수 없었다.
    expect(V40_COPY.send.withAnswersHelp).toContain("상대가 두 사람 결과 링크를 나에게 다시 보내 줘야");
    expect(V40_COPY.send.withAnswersHelp).not.toContain("그 결과 링크");
    // 「자기 코드만 받아요」는 코드를 받는다는 어색한 말이었다.
    expect(V40_COPY.send.questionsOnlyHelp).not.toContain("코드");
    await click(second);
    // 다른 라디오를 골라도 두 도움말은 그대로 보인다.
    expect(root().textContent).toContain(V40_COPY.send.withAnswersHelp);
    expect(root().textContent).toContain(V40_COPY.send.questionsOnlyHelp);
  });

  it("안내 줄: 공유 창, 그리고 답이 든 링크는 되돌릴 수 없고 예전 링크는 남음", async () => {
    await renderBlock();
    expect(root().textContent).toContain(V40_COPY.send.shareSheetInfo);
    expect(root().textContent).toContain(V40_COPY.send.withAnswersLinkInfo);
    // 어떤 답이 읽히는지도 밝힌다(두 사람 결과 링크의 안내와 같은 말)
    expect(root().textContent).toContain(V40_COPY.send.withAnswersSensitiveInfo);
    expect(V40_COPY.send.withAnswersSensitiveInfo).toBe(V40_COPY.coupleSend.sensitiveInfo);
  });

  it("링크 주소는 누르기 전에 화면에도 부르는 쪽 함수에도 나오지 않는다", async () => {
    const { buildUrl } = await renderBlock();
    expect(root().innerHTML).not.toContain("example.test");
    expect(buildUrl).not.toHaveBeenCalled();
    expect(address()).toBeNull();
  });

  it("보낼 말에는 내 글자도 고지 문장도 없고 로마자가 하나도 없다", async () => {
    await renderBlock();
    const text = textarea()?.value ?? "";
    expect(text).not.toMatch(/[A-Za-z]/u);
    expect(text).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });
});

describe("ShareBlock: 체크가 단추를 연다", () => {
  it("막힌 단추를 눌러도 아무것도 보내지 않고 체크 상자로 초점이 간다", async () => {
    const share = vi.fn(async () => undefined);
    const { buildUrl, onSent } = await renderBlock({ share });
    await click(sendButton());
    await flush();
    expect(buildUrl).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(consent());
    expect(statusText()).toBe("");
  });

  it("체크를 켜면 aria-disabled 가 풀리고 이유 글이 사라지며, 끄면 다시 막힌다", async () => {
    await renderBlock();
    await checkConsent();
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("false");
    expect(root().textContent).not.toContain(V40_COPY.send.disabledReason);
    expect(sendButton()?.getAttribute("aria-describedby")).toBeNull();
    await checkConsent();
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(root().textContent).toContain(V40_COPY.send.disabledReason);
  });
});

describe("ShareBlock: 보낸 결과 네 갈래", () => {
  it("공유 창을 마치면 shared: 보낸 말과 주소가 공유 창으로 가고 클립보드에는 쓰지 않는다", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    const { buildUrl, onSent } = await renderBlock({ share, writeText });
    await checkConsent();
    await press();
    expect(buildUrl).toHaveBeenCalledTimes(1);
    expect(buildUrl).toHaveBeenCalledWith("withAnswers");
    expect(share).toHaveBeenCalledWith({ url: URL_WITH, text: V40_COPY.send.messageWithAnswers, title: V40_COPY.send.sheetTitle });
    expect(writeText).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ kind: "shared", option: "withAnswers" });
    expect(statusText()).toBe(V40_COUPLE_SEND_EXTRA_COPY.sharedSheet);
    expect(address()).toBeNull();
    // 공유 창을 마친 것은 클립보드 복사가 아니라서 「복사했어요」라고 말하지 않는다.
    expect(root().textContent).not.toContain(V40_COPY.send.copied);
  });

  it("공유 창이 없고 클립보드가 되면 copied: 링크를 복사했다고 알리고 주소 칸은 열지 않는다", async () => {
    const writeText = vi.fn(async () => undefined);
    const { onSent } = await renderBlock({ writeText });
    await checkConsent();
    await press();
    expect(writeText).toHaveBeenCalledWith(`${V40_COPY.send.messageWithAnswers}\n${URL_WITH}`);
    expect(onSent).toHaveBeenCalledWith({ kind: "copied", option: "withAnswers" });
    expect(statusText()).toBe(V40_COPY.send.copied);
    expect(address()).toBeNull();
  });

  it("둘 다 안 되면 revealed: 실패라 하지 않고 중립 안내와 함께 읽기 전용 주소 칸이 열린다", async () => {
    const { onSent } = await renderBlock({});
    await checkConsent();
    await press();
    expect(onSent).toHaveBeenCalledWith({ kind: "revealed", option: "withAnswers" });
    expect(statusText()).toBe(V40_COPY.send.manualCopy);
    // 데스크톱에서도 맞는 말이다(길게 누른다는 말은 휴대폰에서만 맞았다).
    expect(V40_COPY.send.manualCopy).not.toContain("길게 눌러");
    const field = address();
    expect(field).not.toBeNull();
    expect(field?.readOnly).toBe(true);
    expect(field?.value).toBe(URL_WITH);
    expect(root().querySelector(`label[for="${field?.id}"]`)?.textContent).toBe(V40_COPY.send.addressLabel);
    expect(field ? describedByText(field) : "").toBe(V40_COPY.send.manualCopy);
    expect(document.activeElement).toBe(field);
    expect(statusText()).not.toContain("실패");
  });

  it("공유 창도 클립보드도 거절하면 revealed 이고 주소 칸이 열린다", async () => {
    const denied = new DOMException("허용되지 않았어요", "NotAllowedError");
    const share = vi.fn(async () => {
      throw denied;
    });
    const writeText = vi.fn(async () => {
      throw denied;
    });
    const { onSent } = await renderBlock({ share, writeText });
    await checkConsent();
    await press();
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ kind: "revealed", option: "withAnswers" });
    expect(address()?.value).toBe(URL_WITH);
  });

  it("사람이 공유 창을 닫으면 cancelled: 사건도 안내도 주소 칸도 없다", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("닫았어요", "AbortError");
    });
    const writeText = vi.fn(async () => undefined);
    const { onSent } = await renderBlock({ share, writeText });
    await checkConsent();
    await press();
    expect(onSent).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(statusText()).toBe("");
    expect(address()).toBeNull();
    // 다시 누를 수 있다.
    await press();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it("통계에 쓰는 실제 클립보드 복사는 copied 사건 하나뿐이다", async () => {
    const seen: string[] = [];
    const run = async (env: ShareEnv) => {
      await harness.unmount();
      harness = createHarness();
      const onSent = vi.fn<(event: ShareBlockSentEvent) => void>((event) => seen.push(event.kind));
      await harness.render(<ShareBlock buildUrl={urlFor} onSent={onSent} env={env} idPrefix="t-share" />);
      await checkConsent();
      await press();
    };
    await run({ share: async () => undefined });
    await run({ writeText: async () => undefined });
    await run({});
    expect(seen).toEqual(["shared", "copied", "revealed"]);
    expect(seen.filter((kind) => kind === "copied")).toHaveLength(1);
  });
});

describe("ShareBlock: 질문만 보내기와 보낼 말", () => {
  it("질문만 보내기: 체크가 없고 단추가 바로 열리며 답 없는 주소를 부탁한다", async () => {
    const share = vi.fn(async () => undefined);
    const { buildUrl, onSent } = await renderBlock({ share });
    await click(radios()[1]);
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
    expect(consent()).toBeNull();
    expect(root().textContent).not.toContain(V40_COPY.send.consent);
    // 답이 없는 링크에는 되돌릴 수 없다거나 예전 링크가 남는다는 겁주는 말을 붙이지 않는다.
    expect(root().textContent).not.toContain(V40_COPY.send.withAnswersLinkInfo);
    expect(root().textContent).not.toContain(V40_COPY.send.withAnswersSensitiveInfo);
    expect(root().textContent).not.toMatch(/되돌릴 수 없|예전 링크/u);
    expect(root().textContent).not.toContain(V40_COPY.send.disabledReason);
    expect(sendButton()?.getAttribute("aria-disabled")).toBe("false");
    expect(textarea()?.value).toBe(V40_COPY.send.messageQuestionsOnly);
    await press();
    expect(buildUrl).toHaveBeenCalledWith("questionsOnly");
    expect(share).toHaveBeenCalledWith({ url: URL_ONLY, text: V40_COPY.send.messageQuestionsOnly, title: V40_COPY.send.sheetTitle });
    expect(onSent).toHaveBeenCalledWith({ kind: "shared", option: "questionsOnly" });
  });

  it("고쳐 쓴 보낼 말이 그대로 가고, 라디오를 바꿔도 라디오마다 따로 남는다", async () => {
    const share = vi.fn(async () => undefined);
    await renderBlock({ share });
    const box = textarea();
    if (!box) throw new Error("보낼 말 칸이 없어요");
    await typeInto(box, "고쳐 쓴 말이에요");
    expect(textarea()?.value).toBe("고쳐 쓴 말이에요");
    await click(radios()[1]);
    expect(textarea()?.value).toBe(V40_COPY.send.messageQuestionsOnly);
    await click(radios()[0]);
    expect(textarea()?.value).toBe("고쳐 쓴 말이에요");
    await checkConsent();
    await press();
    expect(share).toHaveBeenCalledWith({ url: URL_WITH, text: "고쳐 쓴 말이에요", title: V40_COPY.send.sheetTitle });
  });

  it("보낼 말을 모두 지우면 주소만 간다", async () => {
    const share = vi.fn(async () => undefined);
    await renderBlock({ share });
    const box = textarea();
    if (!box) throw new Error("보낼 말 칸이 없어요");
    await typeInto(box, "");
    await checkConsent();
    await press();
    expect(share).toHaveBeenCalledWith({ url: URL_WITH, title: V40_COPY.send.sheetTitle });
  });

  it("라디오를 바꾸면 앞의 안내와 주소 칸이 사라진다(다른 링크였다)", async () => {
    await renderBlock({});
    await checkConsent();
    await press();
    expect(address()).not.toBeNull();
    await click(radios()[1]);
    expect(address()).toBeNull();
    expect(statusText()).toBe("");
  });

  it("주소를 만들지 못하면 링크를 만들지 못했다고 알리고 아무것도 보내지 않는다", async () => {
    const share = vi.fn(async () => undefined);
    const { onSent } = await renderBlock({ share }, () => null);
    await checkConsent();
    await press();
    expect(statusText()).toBe(V40_COPY.send.linkFailed);
    expect(share).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(address()).toBeNull();
  });

  it("주소를 만들다 던져도 화면이 무너지지 않고 같은 안내가 나온다", async () => {
    const { onSent } = await renderBlock({}, () => {
      throw new Error("코드를 만들 수 없어요");
    });
    await checkConsent();
    await press();
    expect(statusText()).toBe(V40_COPY.send.linkFailed);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("보내는 중에 다시 눌러도 한 번만 보낸다", async () => {
    let finish: () => void = () => undefined;
    const share = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { onSent } = await renderBlock({ share });
    await checkConsent();
    await click(sendButton());
    expect(sendButton()?.getAttribute("aria-busy")).toBe("true");
    await click(sendButton());
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await flush();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(sendButton()?.getAttribute("aria-busy")).toBeNull();
  });
});

describe("ShareBlock: 지금 브라우저의 공유 창을 쓴다", () => {
  it("환경을 넘기지 않으면 부를 때 navigator.share 를 읽는다", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    const { onSent } = await renderBlock();
    await checkConsent();
    await press();
    expect(share).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ kind: "shared", option: "withAnswers" });
  });

  it("navigator.share 가 없고 clipboard 만 있으면 복사한다", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { onSent } = await renderBlock();
    await checkConsent();
    await press();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ kind: "copied", option: "withAnswers" });
  });
});

describe("ShareBlock: 말씨와 라벨", () => {
  it("평가하거나 주장하는 낱말, 고지 문장이 없다", async () => {
    await renderBlock({});
    await checkConsent();
    await press();
    const text = root().textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("번호나 A/B 라벨이 보이는 글자와 라벨에 없다", async () => {
    await renderBlock({});
    expect(labelProblemsIn(root())).toEqual([]);
  });

  it("제목 레벨을 바꿀 수 있다", async () => {
    await harness.render(<ShareBlock buildUrl={urlFor} onSent={() => undefined} idPrefix="t-share" headingLevel={3} />);
    expect(root().querySelector("h3")?.textContent).toBe(V40_COPY.send.title);
    expect(root().querySelector("h2")).toBeNull();
  });
});

describe("ShareBlock: 링크에 짐작이 든다는 한 줄 guessNote(4.1 단계 2)", () => {
  const NOTE = "링크에 짐작도 들어 있다는 시험용 한 줄이에요.";

  async function renderWithNote(guessNote?: string): Promise<void> {
    await harness.render(<ShareBlock buildUrl={urlFor} onSent={() => undefined} idPrefix="t-share" guessNote={guessNote} />);
  }

  it("「내 답과 함께 보내기」를 고른 동안 안내 묶음에 한 번 그리고, 링크 안내 뒤에 놓는다", async () => {
    await renderWithNote(NOTE);
    const note = root().querySelector("[data-send-guess-note]");
    expect(note?.textContent).toBe(NOTE);
    expect((root().textContent ?? "").split(NOTE).length - 1).toBe(1);
    const infos = [...root().querySelectorAll("p")].map((paragraph) => paragraph.textContent);
    expect(infos.indexOf(NOTE)).toBe(infos.indexOf(V40_COPY.send.withAnswersLinkInfo) + 1);
  });

  it("「질문만 보내기」로 바꾸면 사라지고 다시 「내 답과 함께 보내기」로 돌아오면 다시 나온다(질문만 보내는 링크에는 짐작이 들지 않는다)", async () => {
    await renderWithNote(NOTE);
    await click(radios()[1]);
    expect(root().querySelector("[data-send-guess-note]")).toBeNull();
    expect(root().textContent).not.toContain(NOTE);
    await click(radios()[0]);
    expect(root().querySelector("[data-send-guess-note]")?.textContent).toBe(NOTE);
  });

  it("한 줄을 주지 않으면 어떤 선택에서도 그 줄이 없고 나머지는 그대로다", async () => {
    await renderWithNote();
    expect(root().querySelector("[data-send-guess-note]")).toBeNull();
    const plain = root().innerHTML;
    await renderWithNote(undefined);
    expect(root().innerHTML).toBe(plain);
    await click(radios()[1]);
    expect(root().querySelector("[data-send-guess-note]")).toBeNull();
  });

  it("한 줄이 있어도 링크 단추는 하나이고 체크를 켜야 열리며 링크는 부모가 라디오에 맞게 만든 그대로다", async () => {
    const build = vi.fn<(option: SendOption) => string | null>(urlFor);
    const share = vi.fn(async () => undefined);
    await harness.render(<ShareBlock buildUrl={build} onSent={() => undefined} env={{ share }} idPrefix="t-share" guessNote={NOTE} />);
    expect(root().querySelectorAll("button")).toHaveLength(1);
    await click(sendButton());
    expect(build).not.toHaveBeenCalled();
    await checkConsent();
    await press();
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith("withAnswers");
    expect(share).toHaveBeenCalledTimes(1);
  });
});
