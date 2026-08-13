import { describe, expect, it } from "vitest";

import {
  buildMannersAmoraChatPath,
  MANNERS_AMORA_ALLOWED_SLUGS,
  MANNERS_AMORA_QUERY_PARAM,
  parseMannersAmoraSlug,
} from "../amoraContract";
import { resolveMannersAmoraContext } from "../amoraContext.server";
import { MANNERS_PARTS } from "../data";

describe("manners to Amora contract", () => {
  it("keeps the public allowlist in exact sync with the canonical corpus", () => {
    expect([...MANNERS_AMORA_ALLOWED_SLUGS].sort()).toEqual(
      MANNERS_PARTS.map((part) => part.slug).sort(),
    );
  });

  it("puts only an allowlisted slug in the chat URL", () => {
    const path = buildMannersAmoraChatPath("wedding-day");
    const url = new URL(path, "https://hanbang.ai");

    expect(url.pathname).toBe("/chat");
    expect([...url.searchParams.keys()]).toEqual([MANNERS_AMORA_QUERY_PARAM]);
    expect(url.searchParams.get(MANNERS_AMORA_QUERY_PARAM)).toBe("wedding-day");
    expect(url.searchParams.has("prefill")).toBe(false);
  });

  it.each([
    null,
    undefined,
    "",
    " wedding-day",
    "WEDDING-DAY",
    "../../wedding-day",
    ["wedding-day"],
    { slug: "wedding-day" },
  ])("rejects a query value outside the exact allowlist: %j", (value) => {
    expect(parseMannersAmoraSlug(value)).toBeNull();
    expect(resolveMannersAmoraContext(value)).toBeNull();
  });

  it("fails closed when an internal caller builds a link for an unknown slug", () => {
    expect(() => buildMannersAmoraChatPath("not-a-guide")).toThrow("Unknown manners slug");
  });

  it("resolves title, summary, caveat, and numbered source refs from the corpus", () => {
    const canonical = MANNERS_PARTS.find((part) => part.slug === "wedding-day");
    const context = resolveMannersAmoraContext("wedding-day");

    expect(canonical).toBeDefined();
    expect(context).toEqual({
      kind: "verified_manners_guide",
      version: 1,
      slug: "wedding-day",
      title: canonical!.title,
      summary: canonical!.summary,
      caveat: canonical!.caveat,
      sourceRefs: canonical!.sources.map((source, index) => ({
        ref: index + 1,
        kind: source.kind,
        label: source.label,
        url: source.url,
        checkedAt: source.checkedAt,
        scope: source.scope,
        supports: source.supports,
      })),
    });
    expect(context).not.toHaveProperty("sections");
    expect(context).not.toHaveProperty("description");
  });
});
