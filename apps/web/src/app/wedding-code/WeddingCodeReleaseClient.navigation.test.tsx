// @vitest-environment jsdom

import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { createV30Draft, encodeV30 } from "@/lib/weddingCode/v30";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { buildShareUrl, createSnapshot } from "@/lib/weddingCode/likert/io";
import { parseWeddingCodeEntryQuery } from "./entry";
import WeddingCodeReleaseClient from "./WeddingCodeReleaseClient";

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
  });
});
