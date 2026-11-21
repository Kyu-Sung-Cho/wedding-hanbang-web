import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

/**
 * 실제 커플 화면 시험 도구. 서버는 `fetch` 를 갈아 끼워 흉내 낸다(실제 서버·DB 에 닿지 않는다).
 * 경로마다 응답을 정하고, 어떤 요청이 몇 번 나갔는지 읽는다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Call = { method: string; url: string; body: unknown; signal: AbortSignal | null };
type Reply = Response | Promise<Response> | ((call: Call) => Response | Promise<Response>);

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function apiError(status: number, code: string, error: string): Response {
  return json({ error, code }, status);
}

/** 끝나지 않는 응답(불러오는 중 화면을 볼 때). 멈추면 중단 오류를 낸다. */
export function never(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

/**
 * `"GET /api/invitation/home"` 같은 열쇠로 응답을 정한다. 같은 열쇠에 배열을 주면 차례로 하나씩 쓴다.
 * 정하지 않은 요청이 나가면 시험이 실패한다.
 */
export function mockApi(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(routes).map(([key, reply]) => [key, Array.isArray(reply) ? [...reply] : reply]));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    const entry = queues.get(`${method} ${url}`) ?? queues.get(`${method} ${url.split("?")[0]}`);
    if (entry === undefined) throw new Error(`정하지 않은 요청: ${method} ${url}`);
    let reply: Reply | undefined;
    if (Array.isArray(entry)) {
      reply = entry.length > 1 ? entry.shift() : entry[0];
    } else {
      reply = entry;
    }
    if (reply === undefined) throw new Error(`응답이 떨어졌다: ${method} ${url}`);
    const resolved = typeof reply === "function" ? reply(call) : reply;
    const response = await resolved;
    return response.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    count: (method: string, path: string) => calls.filter((call) => call.method === method && call.url.split("?")[0] === path).length,
    last: (method: string, path: string) => [...calls].reverse().find((call) => call.method === method && call.url.split("?")[0] === path),
  };
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

export async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(node);
  });
  await flush();
  return {
    container,
    rerender: async (next: ReactNode) => {
      await act(async () => root.render(next));
      await flush();
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

/** 응답을 기다리는 약속과 그 뒤의 다시 그리기를 모두 끝낸다. */
export async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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
  await flush();
}

export function text(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find(
    (button) => (button.getAttribute("aria-label") ?? text(button)) === name,
  );
  if (!found) {
    const names = Array.from(scope.querySelectorAll("button")).map((button) => button.getAttribute("aria-label") ?? text(button));
    throw new Error(`단추 "${name}" 이 없다. 있는 것: ${names.join(" / ")}`);
  }
  return found;
}

export function linkTo(scope: ParentNode, href: string): HTMLAnchorElement | null {
  return scope.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

/** 글자(또는 aria-label)로 링크를 찾는다. 주소가 긴 링크(문자 앱 주소 같은)를 이름으로 찾을 때 쓴다. */
export function linkNamed(scope: ParentNode, name: string): HTMLAnchorElement {
  const found = Array.from(scope.querySelectorAll("a")).find((link) => (link.getAttribute("aria-label") ?? text(link)) === name);
  if (!found) {
    const names = Array.from(scope.querySelectorAll("a")).map((link) => link.getAttribute("aria-label") ?? text(link));
    throw new Error(`링크 "${name}" 이 없다. 있는 것: ${names.join(" / ")}`);
  }
  return found;
}

/** 글 칸에 사람이 친 것처럼 값을 넣는다. React 가 듣는 input 사건을 낸다(값은 원래 setter 로 넣어야 React 가 바뀐 줄 안다). */
export async function typeInto(element: Element | null | undefined, value: string) {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) throw new Error("칠 칸이 없다");
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

/** 큰 화면(1024px 이상) 판정을 흉내 낸다. jsdom 에는 matchMedia 가 없다. */
export function mockWide(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(min-width: 64rem)" ? wide : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

export function clearWide() {
  Reflect.deleteProperty(window, "matchMedia");
}
