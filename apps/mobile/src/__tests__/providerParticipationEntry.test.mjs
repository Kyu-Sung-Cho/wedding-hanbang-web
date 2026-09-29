import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { buildMobileSiteUrl, resolveMobileSiteOrigin } from "../lib/siteUrl.mjs";

test("provider discovery and participation open the configured website without session credentials", async () => {
  const source = await readFile(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");
  assert.match(source, /label="웨딩 서비스 찾기 \(웹\)"[\s\S]*?openProviderPage\("\/discover"\)/);
  assert.match(source, /label="웨딩 서비스 등록·문의 \(웹\)"[\s\S]*?openProviderPage\("\/business"\)/);
  assert.match(source, /Linking\.openURL\(buildMobileSiteUrl\(path, providerSiteOrigin\)\)/);
  assert.match(source, /catch \{\s*Alert\.alert\("웹 화면을 열지 못했어요"/);
  const origin = resolveMobileSiteOrigin("https://preview.example.com", { isDevelopment: false });
  for (const path of ["/discover", "/business"]) {
    const target = new URL(buildMobileSiteUrl(path, origin));
    assert.equal(target.origin, origin);
    assert.equal(target.pathname, path);
    assert.equal(target.search, "");
    assert.equal(target.hash, "");
  }
});
