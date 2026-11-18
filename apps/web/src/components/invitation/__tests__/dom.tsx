import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InvitationRouteKey } from "@hanbang/shared/invitation";

/**
 * 청첩장 화면 시험 도우미. 이 앱에는 Testing Library 가 없어서(웹 패키지 의존성에 없다)
 * 저장소의 다른 화면 시험처럼 `createRoot` 와 `act` 로 그리고 DOM 을 직접 읽는다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

export async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(node);
  });
  return {
    container,
    rerender: async (next: ReactNode) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
}

export async function cleanup() {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    if (!entry) break;
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
}

export async function click(element: Element | null | undefined) {
  if (!element) throw new Error("누를 요소가 없다");
  await act(async () => {
    (element as HTMLElement).click();
  });
}

export async function pressKey(element: Element | null | undefined, key: string) {
  if (!element) throw new Error("키를 받을 요소가 없다");
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** 줄바꿈과 겹친 공백을 하나로 접은 글자. */
export function text(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** 접근명: aria-label 이 있으면 그것, 없으면 글자. */
export function accessibleName(element: Element): string {
  return element.getAttribute("aria-label") ?? text(element);
}

function named<T extends Element>(all: T[], name: string, kind: string): T {
  const found = all.find((element) => accessibleName(element) === name);
  if (!found) {
    throw new Error(`${kind} "${name}" 이 없다. 있는 것: ${all.map(accessibleName).join(" / ")}`);
  }
  return found;
}

export function allButtons(scope: ParentNode): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button"));
}

export function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement {
  return named(allButtons(scope), name, "단추");
}

export function allLinks(scope: ParentNode): HTMLAnchorElement[] {
  return Array.from(scope.querySelectorAll("a"));
}

export function linkNamed(scope: ParentNode, name: string): HTMLAnchorElement {
  return named(allLinks(scope), name, "링크");
}

/** 시험용 주소 해석. 이름이 그대로 주소에 남아 어느 화면으로 가는지 바로 읽힌다. */
export const testRoute = (key: InvitationRouteKey) => `/test/${key}`;

/** 시험용 사진 해석. 사진 이름을 그대로 주소로 쓴다. */
export const testPhoto = (photo: string) => `/photos/${photo}.webp`;
