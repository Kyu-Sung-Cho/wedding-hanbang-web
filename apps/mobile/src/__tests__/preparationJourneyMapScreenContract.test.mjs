import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const componentSource = fs.readFileSync(
  path.resolve(here, "../components/planning/PreparationJourneyMap.tsx"),
  "utf8",
);
const scheduleSource = fs.readFileSync(
  path.resolve(here, "../../app/schedule/index.tsx"),
  "utf8",
);

test("the checklist switches between a truthful map and the existing detailed execution surface", () => {
  assert.match(scheduleSource, /buildAmoraPreparationOverview\(\{/u);
  assert.match(scheduleSource, /progress:\s*preparationProgress/u);
  assert.match(
    scheduleSource,
    /attentionTopicKeys:\s*dday === null\s*\?\s*\[\]\s*:\s*weeklyActions\.map/u,
  );
  assert.match(scheduleSource, /title=\{checklistOnly \? "준비 지도" : "일정"\}/u);
  assert.match(scheduleSource, /buildPreparationJourneyMapModel\(preparationOverview\)/u);
  assert.match(scheduleSource, /checklistOnly[\s\S]{0,240}<PreparationJourneyMap/u);
  assert.match(scheduleSource, /onOpenTopic=\{handleJourneyMapTopicPress\}/u);
  assert.match(scheduleSource, /viewMode=\{journeyViewMode\}/u);
  assert.match(scheduleSource, /onViewModeChange=\{setJourneyViewMode\}/u);
  assert.match(scheduleSource, /!checklistOnly\s*\|\|\s*journeyViewMode === "details"/u);
  assert.match(scheduleSource, /buildVerifiedChecklistDeepLink\(\{/u);
  assert.doesNotMatch(
    scheduleSource.match(/const handleJourneyMapTopicPress[\s\S]*?\n\s*\}, \[[^\]]*\]\);/u)?.[0] ?? "",
    /router\.push/u,
  );
  assert.match(scheduleSource, /!checklistOnly[\s\S]{0,120}<Surface tone="noir" style=\{styles\.opsCard\}>/u);

  assert.doesNotMatch(componentSource, /useState/u);
  assert.match(componentSource, /accessibilityRole="tab"/u);
  assert.match(componentSource, /accessibilityState=\{\{\s*selected\s*\}\}/u);
  assert.match(componentSource, /accessibilityRole="button"/u);
  assert.match(componentSource, /accessibilityRole="header"/u);
  assert.match(componentSource, /accessibilityElementsHidden/u);
  assert.match(componentSource, /importantForAccessibility="no-hide-descendants"/u);
  assert.match(componentSource, /onOpenTopic\(node\.topicKey\)/u);
  assert.match(componentSource, /이번에 볼 곳/u);
  assert.match(componentSource, /node\.focusReasonLabel/u);
  assert.match(componentSource, /fontScale\s*>=\s*1\.5/u);
  assert.match(componentSource, /maxWidth:\s*"100%"/u);
  assert.match(componentSource, /flexShrink:\s*1/u);
  assert.match(componentSource, /minHeight:\s*48/u);
  assert.match(componentSource, /color:\s*colors\.noir\[800\]/u);
  assert.doesNotMatch(componentSource, /chapterIndex\s*\+\s*1|기본 확인 순서|progressbar|전체 진행률|XP|레벨|잠금|numberOfLines/u);
});
