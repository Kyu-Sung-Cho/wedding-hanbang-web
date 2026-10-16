// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { createV30Draft, encodeV30 } from "@/lib/weddingCode/v30";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { buildShareUrl, createSnapshot } from "@/lib/weddingCode/likert/io";
import { parseWeddingCodeEntryQuery } from "./entry";
import WeddingCodeReleaseClient from "./WeddingCodeReleaseClient";
import { WEDDING_CODE_BARE_TARGET } from "./releaseEntry";

/** 64문항 화면 모듈이 실제로 요청됐는지 시험이 본다(늦게 불러오므로 36·30문항·구판 방문자는 요청하지 않아야 한다). */
const wc64Chunk = vi.hoisted(() => ({ requested: 0 }));
vi.mock("@/components/weddingCode64/WeddingCode64Client", () => {
  wc64Chunk.requested += 1;
  return { default: function Wc64Probe() { return <section data-release="wc64" />; } };
});

vi.mock("./WeddingCodeClient", () => ({
  default: function Release36Probe() { return <section data-release="36" />; },
}));

vi.mock("@/components/weddingCodeLikert/WeddingCodeLikertClient", () => ({
  default: function LikertProbe() {
    const [edited, setEdited] = useState(false);
    return <section data-release="likert" data-edited={edited}>
      <button onClick={() => setEdited(true)}>local edit</button>
    </section>;
  },
}));

vi.mock("./WeddingCodeEntryClient", () => ({
  default: function LegacyProbe() {
    const [edited, setEdited] = useState(false);
    return <section data-release="legacy" data-edited={edited}>
      <button onClick={() => setEdited(true)}>local edit</button>
      <button onClick={() => window.history.replaceState(null, "", window.location.pathname)}>clear received address</button>
    </section>;
  },
}));

let harness: Harness;
const props = {
  queryIsLegacy: false,
  shareOrigin: "https://hanbang.ai",
  initialEntry: parseWeddingCodeEntryQuery({}),
  researchContributionOpen: false,
  researchStorageActive: false,
};
const legacyHash = `#v=${WEDDING_CODE_V30_VERSION}&a=${encodeV30(createV30Draft())}`;

function likertHash(): string {
  const answers = Object.fromEntries(ITEMS.map(item => [item.id, { status: "rated" as const, value: 3 as const }]));
  const url = buildShareUrl(window.location.origin, createSnapshot(answers));
  if (!url) throw new Error("Fixture invite link missing");
  return new URL(url).hash;
}

async function render(queryIsLegacy = false) {
  await harness.render(<WeddingCodeReleaseClient {...props} queryIsLegacy={queryIsLegacy}
    initialEntry={queryIsLegacy ? parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V30_VERSION }) : props.initialEntry} />);
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function navigate(url: string, event: "hashchange" | "popstate") {
  await act(async () => {
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(event));
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/wedding-code");
  harness = createHarness();
});
afterEach(async () => { await harness.unmount(); });

describe("공개 입구가 소유한 경로의 판별만 유지한다", () => {
  it.each(["hashchange", "popstate"] as const)("외부 목차의 %s와 부모 재렌더는 응답 중인 새 판을 교체하지 않는다", async event => {
    const hash = likertHash();
    window.history.replaceState(null, "", `/wedding-code${hash}`);
    await render();
    await click(harness.container.querySelector("button"));
    const original = harness.container.querySelector('[data-release="likert"]');
    expect(original?.getAttribute("data-edited")).toBe("true");

    await navigate("/#features", event);
    await render();
    expect(harness.container.querySelector('[data-release="likert"]')).toBe(original);
    expect(original?.getAttribute("data-edited")).toBe("true");
    expect(harness.container.querySelector('[data-release="legacy"]')).toBeNull();
    expect(window.location.pathname).toBe("/");

    await navigate(`/wedding-code${legacyHash}`, event);
    expect(harness.container.querySelector('[data-release="legacy"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="likert"]')).toBeNull();
    await navigate(`/wedding-code${hash}`, event);
    expect(harness.container.querySelector('[data-release="likert"]')?.getAttribute("data-edited")).toBe("false");
    await settle();
    expect(wc64Chunk.requested).toBe(0);
  });

  it.each(["hashchange", "popstate"] as const)("구판이 주소를 비운 뒤 외부 응답 링크의 %s도 붙잡은 판과 로컬 편집을 바꾸지 않는다", async event => {
    window.history.replaceState(null, "", `/wedding-code${legacyHash}`);
    await render();
    await click(harness.container.querySelector("button"));
    await click([...harness.container.querySelectorAll("button")].find(button => button.textContent === "clear received address"));
    expect(window.location.hash).toBe("");
    const original = harness.container.querySelector('[data-release="legacy"]');

    await navigate(`/privacy${likertHash()}`, event);
    await render();
    expect(harness.container.querySelector('[data-release="legacy"]')).toBe(original);
    expect(original?.getAttribute("data-edited")).toBe("true");
    expect(harness.container.querySelector('[data-release="likert"]')).toBeNull();

    await navigate("/wedding-code", event);
    await render();
    expect(harness.container.querySelector('[data-release="legacy"]')).toBe(original);
    expect(original?.getAttribute("data-edited")).toBe("true");
    await navigate(`/wedding-code${likertHash()}`, event);
    expect(harness.container.querySelector('[data-release="likert"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="legacy"]')).toBeNull();
    await settle();
    expect(wc64Chunk.requested).toBe(0);
  });

  it("명시된 구판 query 입구는 새 판 해시로도 자동 교체하지 않는다", async () => {
    window.history.replaceState(null, "", "/wedding-code?v=v3.0-preferences");
    await render(true);
    await click(harness.container.querySelector("button"));
    const original = harness.container.querySelector('[data-release="legacy"]');
    await navigate(`/wedding-code?v=v3.0-preferences${likertHash()}`, "hashchange");
    await render(true);
    expect(harness.container.querySelector('[data-release="legacy"]')).toBe(original);
    expect(original?.getAttribute("data-edited")).toBe("true");
    expect(harness.container.querySelector('[data-release="likert"]')).toBeNull();
    await settle();
    expect(wc64Chunk.requested).toBe(0);
  });
});

describe("맨 주소와 명시 주소가 고르는 판", () => {
  // 모듈 요청 수는 파일 안에서 한 번만 늘어난다(모듈 캐시). 그래서 64문항을 그리는 시험보다 먼저 돌아야 하는
  // 36·30문항·구판 시험은 위 describe 와 이 시험에 두고, 여기서 아직 0인지 본다.
  it("명시 36·30문항 해시·구판 해시를 그리는 동안 64문항 모듈을 요청하지 않는다", async () => {
    expect(wc64Chunk.requested).toBe(0);
    await harness.render(<WeddingCodeReleaseClient {...props} explicitTarget="36" />);
    await settle();
    expect(harness.container.querySelector('[data-release="36"]')).not.toBeNull();
    expect(wc64Chunk.requested).toBe(0);
    await harness.unmount();
    for (const hash of [likertHash(), legacyHash]) {
      window.history.replaceState(null, "", `/wedding-code${hash}`);
      harness = createHarness();
      await harness.render(<WeddingCodeReleaseClient {...props} />);
      await settle();
      expect(harness.container.querySelector('[data-release="wc64"]')).toBeNull();
      expect(wc64Chunk.requested).toBe(0);
      await harness.unmount();
    }
    harness = createHarness();
  });

  it("해시 없는 맨 주소는 스위치 상수가 정한 판을 열고, 64문항이면 늦게 불러온 화면을 그린다", async () => {
    await render();
    await settle();
    expect(harness.container.querySelector(`[data-release="${WEDDING_CODE_BARE_TARGET}"]`)).not.toBeNull();
    expect(harness.container.querySelector('[data-release="legacy"]')).toBeNull();
    if (WEDDING_CODE_BARE_TARGET === "wc64") expect(wc64Chunk.requested).toBe(1);
  });

  it("명시 36(?v=36, 초대 ?ct=)은 36문항을, 명시 64는 64문항을 연다", async () => {
    await harness.render(<WeddingCodeReleaseClient {...props} explicitTarget="36" />);
    await settle();
    expect(harness.container.querySelector('[data-release="36"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="wc64"]')).toBeNull();
    await harness.unmount();
    harness = createHarness();
    await harness.render(<WeddingCodeReleaseClient {...props} explicitTarget="wc64" />);
    await settle();
    expect(harness.container.querySelector('[data-release="wc64"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="36"]')).toBeNull();
  });

  it("명시 64여도 30문항 해시는 30문항으로, 구판 해시는 구판으로 보낸다", async () => {
    window.history.replaceState(null, "", `/wedding-code${likertHash()}`);
    await harness.render(<WeddingCodeReleaseClient {...props} explicitTarget="wc64" />);
    await settle();
    expect(harness.container.querySelector('[data-release="likert"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="wc64"]')).toBeNull();
    await harness.unmount();
    window.history.replaceState(null, "", `/wedding-code${legacyHash}`);
    harness = createHarness();
    await harness.render(<WeddingCodeReleaseClient {...props} explicitTarget="wc64" />);
    await settle();
    expect(harness.container.querySelector('[data-release="legacy"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-release="wc64"]')).toBeNull();
  });
});

/* ---------------- 소스 검사: 64문항이 다른 판의 번들에 붙지 않는다 ---------------- */

function sourceOf(relative: string): string {
  const raw = readFileSync(resolve(process.cwd(), "src", relative), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("64문항 모듈은 늦게만 불러온다", () => {
  it("판 라우터는 64문항 화면을 정적 import 하지 않고 dynamic(() => import(...)) 안에서만 부른다", () => {
    const code = sourceOf("app/wedding-code/WeddingCodeReleaseClient.tsx");
    expect(code).not.toMatch(/^\s*import\s[^;]*?from\s+["']@\/components\/weddingCode64/m);
    expect(code).not.toMatch(/^\s*import\s[^;]*?from\s+["']@\/lib\/weddingCode\/wc64\/(?!types["'])/m);
    const mentions = [...code.matchAll(/@\/components\/weddingCode64[^"']*/g)];
    const lazy = [...code.matchAll(/dynamic\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/weddingCode64[^"']*["']\s*\)/g)];
    expect(lazy).toHaveLength(1);
    expect(mentions).toHaveLength(lazy.length);
  });

  it("releaseEntry 가 가져오는 wc64/types.ts 는 아무것도 import 하지 않는다(서버와 모든 판에 은행이 실리지 않게)", () => {
    const code = sourceOf("lib/weddingCode/wc64/types.ts");
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    expect(code).not.toMatch(/^\s*export\s[^;]*?\sfrom\s+["']/m);
  });
});
