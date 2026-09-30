import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_COPY, V40_NOT_VALIDATED_PHRASE } from "@/lib/weddingCode/v40/copy";
import { click, createHarness, describedByText, type Harness } from "./inputTestKit";
import { ResultHeader } from "./ResultHeader";
import { buttonByText, countOf, hasButton, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

const COPY_TEXT = "웨딩코드 SWUA (S 장면 먼저 · 기울어요, W 같이 하기 · 뚜렷해요, U 둘이 정하기 · 기울어요, A 할 일 먼저 · 반반이에요)";

interface Deferred {
  readonly promise: Promise<boolean>;
  resolve(value: boolean): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: (value: boolean) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function status(): HTMLElement {
  return harness.container.querySelector<HTMLElement>("[data-copy-status]")!;
}

describe("ResultHeader", () => {
  it("제목, 제목 바로 아래 고지 한 문장(한 번), 작은 코드 복사 단추, 복사 안내", async () => {
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={vi.fn(() => true)} />);
    const header = harness.container.querySelector("header")!;
    expect(header.querySelector("h1")?.textContent).toBe(V40_COPY.result.title);
    expect(header.querySelector("[data-result-notice]")?.textContent).toBe(V40_COPY.result.notice);
    expect(countOf(textOf(header), V40_NOT_VALIDATED_PHRASE)).toBe(1);
    // 제목 다음이 고지다
    const title = header.querySelector("h1")!;
    const notice = header.querySelector("[data-result-notice]")!;
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = buttonByText(header, V40_COPY.copyCode.button);
    expect(describedByText(button)).toBe(V40_COPY.copyCode.hint);
    expect(textOf(header)).toContain("상대가 답하기 전에는 보내지 않는 게 좋아요");
    // 왜 보내지 않는 게 좋은지(내 글자를 먼저 보면 답이 끌린다)도 화면에서 말한다.
    expect(textOf(header)).toContain("내 글자를 먼저 보면 답이 끌릴 수 있어요");
    // 복사 안내는 고지 문장에 섞이지 않는다
    expect(V40_COPY.copyCode.hint).not.toContain(V40_NOT_VALIDATED_PHRASE);
  });

  it("notice 를 주면 그 고지가 결과 고지 대신 한 번 나온다(글자가 없는 결과)", async () => {
    await harness.render(<ResultHeader copyText={null} onCopyCode={vi.fn(() => true)} notice={V40_COPY.receive.notice} />);
    const notice = harness.container.querySelector("[data-result-notice]")!;
    expect(notice.textContent).toBe(V40_COPY.receive.notice);
    expect(notice.textContent).not.toContain("글자가 달라질 수 있어요");
    expect(countOf(textOf(harness.container), V40_NOT_VALIDATED_PHRASE)).toBe(1);
  });

  it("코드가 없으면(관문) 복사 단추도 안내도 없고 고지는 그대로 한 번", async () => {
    await harness.render(<ResultHeader copyText={null} onCopyCode={vi.fn(() => true)} />);
    expect(hasButton(harness.container, V40_COPY.copyCode.button)).toBe(false);
    expect(textOf(harness.container)).not.toContain(V40_COPY.copyCode.hint);
    expect(countOf(textOf(harness.container), V40_NOT_VALIDATED_PHRASE)).toBe(1);
  });

  it("제목 수준을 고를 수 있다", async () => {
    await harness.render(<ResultHeader copyText={null} onCopyCode={vi.fn(() => true)} headingLevel={2} />);
    expect(harness.container.querySelector("h1")).toBeNull();
    expect(harness.container.querySelector("h2")?.textContent).toBe(V40_COPY.result.title);
  });

  it("부모가 true 를 돌려준 뒤에만 복사했다고 말한다", async () => {
    const pending = deferred();
    const onCopyCode = vi.fn(() => pending.promise);
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={onCopyCode} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    // 아직 부모가 답하지 않았다
    expect(onCopyCode).toHaveBeenCalledWith(COPY_TEXT);
    expect(status().textContent).toBe("");
    expect(harness.container.textContent).not.toContain(V40_COPY.copyCode.copied);
    const button = harness.container.querySelector("button")!;
    expect(button.getAttribute("aria-busy")).toBe("true");
    // 복사하는 동안에도 단추는 켜져 있다: 꺼지면 초점을 받은 단추가 초점을 잃는다(키보드 사용자가 자리를 잃는다).
    expect(button.disabled).toBe(false);
    // 한 번 더 눌러도 부모를 다시 부르지 않는다
    await click(button);
    expect(onCopyCode).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.copied);
    expect(status().getAttribute("role")).toBe("status");
    expect(harness.container.querySelector("textarea")).toBeNull();
    expect(harness.container.querySelector("button")!.disabled).toBe(false);
  });

  it("코드 복사를 눌러도(복사하는 동안에도, 끝난 뒤에도) 초점이 그 단추에 남는다", async () => {
    const pending = deferred();
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={() => pending.promise} />);
    const button = buttonByText(harness.container, V40_COPY.copyCode.button) as HTMLButtonElement;
    await act(async () => button.focus());
    expect(document.activeElement).toBe(button);
    await click(button);
    expect(document.activeElement).toBe(button);
    await act(async () => pending.resolve(true));
    await settle();
    expect(document.activeElement).toBe(button);
    expect(status().textContent).toBe(V40_COPY.copyCode.copied);
  });

  it("false 이면 복사했다고 말하지 않고 안 됐다고 알리며 직접 복사할 글을 읽기 전용으로 보여 준다", async () => {
    const onCopyCode = vi.fn(async () => false);
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={onCopyCode} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.failed);
    expect(harness.container.textContent).not.toContain(V40_COPY.copyCode.copied);
    const box = harness.container.querySelector("textarea")!;
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe(COPY_TEXT);
    // 글 상자의 이름은 안내 문장이다
    expect(document.getElementById(box.getAttribute("aria-labelledby")!)?.textContent).toBe(V40_COPY.copyCode.failed);
  });

  it("던져도, 동기로 false 를 돌려줘도 복사했다고 말하지 않는다", async () => {
    await harness.render(
      <ResultHeader
        copyText={COPY_TEXT}
        onCopyCode={() => {
          throw new Error("denied");
        }}
      />,
    );
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.failed);
    await harness.render(<ResultHeader key="sync-false" copyText={COPY_TEXT} onCopyCode={() => false} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.failed);
  });

  it("true 가 아닌 값(문자열, 빈 값)은 성공으로 세지 않는다", async () => {
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={(() => "ok") as unknown as () => boolean} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.failed);
  });

  it("실패 뒤 다시 눌러 성공하면 실패 안내와 글 상자가 사라진다", async () => {
    const onCopyCode = vi.fn<(text: string) => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={onCopyCode} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(harness.container.querySelector("textarea")).not.toBeNull();
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await settle();
    expect(status().textContent).toBe(V40_COPY.copyCode.copied);
    expect(harness.container.querySelector("textarea")).toBeNull();
  });

  it("답이 오기 전에 화면이 사라져도 오류가 나지 않는다", async () => {
    const pending = deferred();
    await harness.render(<ResultHeader copyText={COPY_TEXT} onCopyCode={() => pending.promise} />);
    await click(buttonByText(harness.container, V40_COPY.copyCode.button));
    await harness.render(<div />);
    await act(async () => pending.resolve(true));
    await settle();
    expect(harness.container.textContent).toBe("");
  });
});
