import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const feed = readFileSync(resolve(appRoot, "app/(tabs)/community.tsx"), "utf8");

test("community puts real decision records and latest posts before discovery modules", () => {
  const decisionStart = feed.indexOf("function renderDecisionSection()");
  const headerStart = feed.indexOf("function renderHeader()");
  const footerStart = feed.indexOf("function renderDiscoveryFooter()");
  const screenStart = feed.indexOf("return (\n    <SafeAreaView", footerStart);

  assert.ok(decisionStart >= 0);
  assert.ok(headerStart > decisionStart);
  assert.ok(footerStart > headerStart);
  assert.ok(screenStart > footerStart);

  const header = feed.slice(headerStart, footerStart);
  const discoveryFooter = feed.slice(footerStart, screenStart);

  assert.match(header, /renderDecisionSection/);
  assert.match(header, /커뮤니티 최신글/);
  assert.match(header, /지금 올라온 이야기/);
  assert.doesNotMatch(header, /MyCohortCard|CohortExploreSection|QuickActionsBar|CATEGORIES/);

  assert.match(discoveryFooter, /보조 탐색/);
  assert.match(discoveryFooter, /QuickActionsBar/);
  assert.match(discoveryFooter, /MyCohortCard/);
  assert.match(discoveryFooter, /CohortExploreSection/);

  assert.match(feed, /ListHeaderComponent=\{renderHeader\}/);
  assert.match(feed, /ListFooterComponent=\{renderDiscoveryFooter\}/);
});

test("decision surface is factual, reviewed, and does not invent activity", () => {
  assert.match(feed, /parseCommunityDecisionFeed/);
  assert.match(feed, /parseCommunityDecisionInbox/);
  assert.match(feed, /둘러보기/);
  assert.match(feed, /내 경험 필요/);
  assert.match(feed, /작성자가 돌아와 남긴 결과/);
  assert.match(feed, /없는 활동을 꾸며 보여주지 않고/);
  assert.doesNotMatch(feed, /나에게 추천|실시간 인기|방금 \d+명/);
});

test("community keeps decision writing primary and generic writing available", () => {
  assert.match(feed, /<AppHeader title="커뮤니티"/);
  assert.match(feed, /<EmptyState/);
  assert.match(feed, /accessibilityLabel="경험 기반 결정 질문 쓰기"/);
  assert.match(feed, /router\.push\("\/community\/decision\/write" as never\)/);
  assert.equal((feed.match(/router\.push\(\{ pathname: "\/community\/post\/write" \}\)/g) ?? []).length, 1);
});

test("decision mode changes clear old-mode cards before the next exact feed arrives", () => {
  const handlerStart = feed.indexOf("function handleDecisionModeChange");
  const renderStart = feed.indexOf("function renderDecisionSection()", handlerStart);
  assert.ok(handlerStart >= 0 && renderStart > handlerStart);

  const handler = feed.slice(handlerStart, renderStart);
  const invalidation = handler.indexOf("decisionRequestSequence.current += 1");
  const clear = handler.indexOf("setDecisionFeed(null)");
  const loading = handler.indexOf("setDecisionLoading(true)");
  const changeMode = handler.indexOf("setDecisionMode(mode)");
  assert.ok(invalidation >= 0 && clear > invalidation);
  assert.ok(loading > clear && changeMode > loading);

  const decisionSection = feed.slice(renderStart, feed.indexOf("function renderHeader()", renderStart));
  assert.match(decisionSection, /decisionFeed\?\.mode === decisionMode/u);
  assert.match(decisionSection, /decisionLoading && !visibleDecisionFeed/u);
  assert.match(decisionSection, /decisionError \?/u);
  assert.match(decisionSection, /불러오기 실패를 활동 없음으로 표시하지 않았어요/u);
  assert.doesNotMatch(decisionSection, /if \(!shouldShow\) return null/u);
  assert.match(decisionSection, /visibleDecisionFeed\?\.items\.map/u);
  assert.match(decisionSection, /onPress=\{\(\) => handleDecisionModeChange\(mode\)\}/u);
  assert.doesNotMatch(decisionSection, /onPress=\{\(\) => setDecisionMode\(mode\)\}/u);
});

test("decision cards disclose question and outcome relationships accessibly without truth overclaims", () => {
  assert.match(feed, /item\.outcome\.commercialRelationship/u);
  assert.match(feed, /item\.outcome\.sponsorshipDetail/u);
  assert.match(feed, /질문 이해관계 공개/u);
  assert.match(feed, /결과 이해관계 공개/u);
  assert.match(feed, /accessibilityLabel=\{questionDisclosure\}/u);
  assert.match(feed, /accessibilityLabel=\{outcomeDisclosure\}/u);
  assert.match(feed, /accessibilityParts\.push\(questionDisclosure\)/u);
  assert.match(feed, /accessibilityParts\.push\(outcomeDisclosure\)/u);
  assert.match(feed, /자격·조건 확인 답변/u);
  assert.doesNotMatch(feed, /검증된 경험/u);
});

test("decision inbox failure stays distinct from a real zero count", () => {
  assert.match(feed, /const \[decisionInboxError, setDecisionInboxError\] = useState\(false\)/u);
  assert.match(feed, /parseCommunityDecisionInbox\(inboxResult\.value\)/u);
  assert.match(feed, /setDecisionInboxError\(true\)/u);
  assert.match(feed, /guestWithoutSession/u);
  assert.match(feed, /내 결정 알림을 불러오지 못했어요/u);
  assert.match(feed, /알림 없음으로 처리하지 않았어요/u);
});
