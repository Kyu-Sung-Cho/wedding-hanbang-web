import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdDisclosureModal from "./AdDisclosureModal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 광고 표시 모달. 처음 열면 아무것도 골라져 있지 않고(건너뛸 수 없다), 실패 뒤 다시 열 때만
 * 화면이 넘겨 준 지난 선택을 채워 둔다. 15초 후기가 협찬 후기를 다시 보낼 때 같은 본문을
 * 만들려면 이 값이 그대로 돌아와야 한다.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(element: Element | null | undefined, what: string) {
  expect(element, `${what} 을(를) 찾지 못했다`).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function option(label: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((button) => button.querySelector("span")?.textContent === label);
}

function confirmButton() {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "확인");
}

describe("광고 표시 모달", () => {
  it("넘겨 준 값이 없으면 전처럼 비어 있고, 고르지 않으면 넘어가지 않는다", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(<AdDisclosureModal onSelect={onSelect} />);
    });
    expect(container.querySelector("textarea")).toBeNull();
    await click(confirmButton(), "확인");
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("유형을 선택해주세요.");

    await click(option("일반 글"), "일반 글");
    await click(confirmButton(), "확인");
    expect(onSelect.mock.calls).toStrictEqual([[{ adDisclosure: "general" }]]);
  });

  it("지난 협찬 선택을 넘겨 주면 채워 두고, 확인만 누르면 같은 값을 돌려준다", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <AdDisclosureModal
          onSelect={onSelect}
          initialChoice={{ adDisclosure: "sponsored", sponsorshipDetail: "드레스 대여비 1회 제공받음" }}
        />,
      );
    });
    expect(container.querySelector("textarea")?.value).toBe("드레스 대여비 1회 제공받음");
    await click(confirmButton(), "확인");
    expect(onSelect.mock.calls).toStrictEqual([
      [{ adDisclosure: "sponsored", sponsorshipDetail: "드레스 대여비 1회 제공받음" }],
    ]);
  });

  it("채워 둔 선택도 바꿀 수 있다", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(<AdDisclosureModal onSelect={onSelect} initialChoice={{ adDisclosure: "general" }} />);
    });
    await click(option("광고"), "광고");
    await click(confirmButton(), "확인");
    expect(onSelect.mock.calls).toStrictEqual([[{ adDisclosure: "ad" }]]);
  });

  it("null 을 넘기면 넘겨 주지 않은 것과 같다", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(<AdDisclosureModal onSelect={onSelect} initialChoice={null} />);
    });
    expect(container.querySelector("textarea")).toBeNull();
    await click(confirmButton(), "확인");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
