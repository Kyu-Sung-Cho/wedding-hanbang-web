import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildMediationOutcomeBody,
  isCurrentMediationOutcomeContext,
  isMediationOutcomeCardAdvanced,
  isReceiptForMediationOutcomeRequest,
  matchCanonicalMediationOutcomeReceipt,
  resolveMediationOutcomeSurface,
} from "../lib/mediationOutcomeFollowUp.mjs";
import {
  classifyPrivateMediationSafetyHoldRecord,
  createPrivateMediationSafetyHoldRuntime,
  createPrivateMediationSafetyHoldRecord,
  parsePrivateMediationSafetyHoldRecord,
  persistPrivateMediationSafetyHoldRecord,
  privateMediationSafetyHoldPersistentKey,
  readPrivateMediationSafetyHoldStores,
  shouldSuppressForPrivateMediationSafetyHold,
} from "../lib/privateMediationSafetyHold.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const CARD = {
  id: "30000000-0000-4000-8000-000000000001",
  revision: 2,
  sourceDigest: "a".repeat(64),
  outcomeIdempotencyKey: "40000000-0000-4000-8000-000000000001",
};

test("mediation outcome body binds the exact private card and bounded choice", () => {
  assert.deepEqual(buildMediationOutcomeBody(CARD, "blocked"), {
    cardId: CARD.id,
    cardRevision: 2,
    sourceDigest: CARD.sourceDigest,
    outcome: "blocked",
    idempotencyKey: CARD.outcomeIdempotencyKey,
  });
  assert.equal(buildMediationOutcomeBody(CARD, "retry_mediation"), null);
  assert.equal(buildMediationOutcomeBody({ ...CARD, sourceDigest: "raw" }, "blocked"), null);
  assert.equal(buildMediationOutcomeBody({ ...CARD, note: "free text" }, "blocked"), null);
});

test("late callbacks are rejected after an account, couple, or session switch", () => {
  const captured = {
    ownerUserId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
    sessionGeneration: 4,
  };
  assert.equal(isCurrentMediationOutcomeContext(captured, { ...captured }), true);
  assert.equal(isCurrentMediationOutcomeContext(captured, {
    ...captured,
    ownerUserId: "10000000-0000-4000-8000-000000000002",
  }), false);
  assert.equal(isCurrentMediationOutcomeContext(captured, {
    ...captured,
    coupleId: "20000000-0000-4000-8000-000000000002",
  }), false);
  assert.equal(isCurrentMediationOutcomeContext(captured, {
    ...captured,
    sessionGeneration: 5,
  }), false);
});

test("the persistent device hold uses only a digest key and an identifier-free marker", () => {
  const ownerUserId = "10000000-0000-4000-8000-000000000001";
  const coupleId = "20000000-0000-4000-8000-000000000001";
  const record = createPrivateMediationSafetyHoldRecord({ ownerUserId, coupleId });
  const persistentKey = privateMediationSafetyHoldPersistentKey("a".repeat(64));
  assert.equal(persistentKey, `hb.opaque.v1.${"a".repeat(64)}`);
  assert.equal(parsePrivateMediationSafetyHoldRecord(record, {
    ownerUserId,
    coupleId,
  }), true);
  assert.deepEqual(JSON.parse(record), { version: 1, active: true });
  assert.doesNotMatch(
    `${persistentKey}:${record}`,
    /10000000|20000000|safety|mediation|raw|summary|reason|classification|emotion|intent|disclosure/iu,
  );
  assert.equal(parsePrivateMediationSafetyHoldRecord(
    JSON.stringify({ ...JSON.parse(record), rawText: "must never persist" }),
    { ownerUserId, coupleId },
  ), false);
  assert.equal(shouldSuppressForPrivateMediationSafetyHold("{corrupt", {
    ownerUserId,
    coupleId,
  }), true);
  assert.equal(classifyPrivateMediationSafetyHoldRecord(record, {
    ownerUserId,
    coupleId,
  }), "active");
  assert.equal(shouldSuppressForPrivateMediationSafetyHold(null, {
    ownerUserId,
    coupleId,
  }), false);
});

test("the device runtime latches the exact owner and couple before digest or storage settles", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000011",
    coupleId: "20000000-0000-4000-8000-000000000011",
  };
  const otherCouple = {
    ...owner,
    coupleId: "20000000-0000-4000-8000-000000000012",
  };
  let releaseDigest;
  const digestGate = new Promise((resolve) => { releaseDigest = resolve; });
  const digestInputs = [];
  const writes = [];
  const runtime = createPrivateMediationSafetyHoldRuntime({
    digestSha256: async (input) => {
      digestInputs.push(input);
      if (input.includes(owner.coupleId)) await digestGate;
      return input.includes(owner.coupleId) ? "a".repeat(64) : "b".repeat(64);
    },
    writeSecure: async (key, value) => { writes.push(["secure", key, value]); },
    writeJournal: async (key, value) => { writes.push(["journal", key, value]); },
    readSecure: async () => null,
    readJournal: async () => null,
  }, { timeoutMs: 50 });

  const sealing = runtime.seal(owner);
  await Promise.resolve();
  assert.equal(await runtime.has(owner), true);
  assert.equal(await runtime.has(otherCouple), false);

  releaseDigest();
  await sealing;
  assert.deepEqual(digestInputs, [
    `hanbang:opaque:v1\u0000${owner.ownerUserId}\u0000${owner.coupleId}`,
    `hanbang:opaque:v1\u0000${otherCouple.ownerUserId}\u0000${otherCouple.coupleId}`,
  ]);
  assert.deepEqual(writes.map(([store, key]) => [store, key]), [
    ["secure", `hb.opaque.v1.${"a".repeat(64)}`],
    ["journal", `hb.opaque.v1.${"a".repeat(64)}`],
  ]);
});

test("digest rejection or timeout fails closed only for the exact runtime owner", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000021",
    coupleId: "20000000-0000-4000-8000-000000000021",
  };
  const otherOwner = {
    ownerUserId: "10000000-0000-4000-8000-000000000022",
    coupleId: "20000000-0000-4000-8000-000000000022",
  };
  for (const digestFailure of [
    async () => { throw new Error("digest unavailable"); },
    async () => new Promise(() => {}),
  ]) {
    const runtime = createPrivateMediationSafetyHoldRuntime({
      digestSha256: (input) => input.includes(owner.ownerUserId)
        ? digestFailure()
        : Promise.resolve("b".repeat(64)),
      writeSecure: async () => undefined,
      writeJournal: async () => undefined,
      readSecure: async () => null,
      readJournal: async () => null,
    }, { timeoutMs: 10 });

    await assert.rejects(runtime.seal(owner), {
      message: "PRIVATE_MEDIATION_SAFETY_HOLD_DIGEST_FAILED",
    });
    assert.equal(await runtime.has(owner), true);
    assert.equal(await runtime.has(otherOwner), false);
  }
});

test("two failed or timed-out device writes leave the exact process latch active", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000031",
    coupleId: "20000000-0000-4000-8000-000000000031",
  };
  const otherCouple = {
    ...owner,
    coupleId: "20000000-0000-4000-8000-000000000032",
  };
  for (const writer of [
    async () => { throw new Error("store unavailable"); },
    async () => new Promise(() => {}),
  ]) {
    const runtime = createPrivateMediationSafetyHoldRuntime({
      digestSha256: async (input) => input.includes(owner.coupleId)
        ? "c".repeat(64)
        : "d".repeat(64),
      writeSecure: writer,
      writeJournal: writer,
      readSecure: async () => null,
      readJournal: async () => null,
    }, { timeoutMs: 10 });

    await assert.rejects(runtime.seal(owner), {
      message: "PRIVATE_MEDIATION_SAFETY_HOLD_WRITE_FAILED",
    });
    assert.equal(await runtime.has(owner), true);
    assert.equal(await runtime.has(otherCouple), false);
  }
});

test("a fresh runtime after restart restores only the persisted owner and couple hold", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000041",
    coupleId: "20000000-0000-4000-8000-000000000041",
  };
  const otherOwner = {
    ownerUserId: "10000000-0000-4000-8000-000000000042",
    coupleId: "20000000-0000-4000-8000-000000000042",
  };
  const journal = new Map();
  const adapters = {
    digestSha256: async (input) => input.includes(owner.ownerUserId)
      ? "e".repeat(64)
      : "f".repeat(64),
    writeSecure: async () => { throw new Error("secure store unavailable"); },
    writeJournal: async (key, value) => { journal.set(key, value); },
    readSecure: async () => null,
    readJournal: async (key) => journal.get(key) ?? null,
  };

  const beforeRestart = createPrivateMediationSafetyHoldRuntime(adapters);
  await beforeRestart.seal(owner);
  const afterRestart = createPrivateMediationSafetyHoldRuntime(adapters);

  assert.equal(await afterRestart.has(owner), true);
  assert.equal(await afterRestart.has(otherOwner), false);
  assert.deepEqual([...journal.keys()], [`hb.opaque.v1.${"e".repeat(64)}`]);
});

test("a second opaque device journal survives a primary-store write failure and restart", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000001",
    coupleId: "20000000-0000-4000-8000-000000000001",
  };
  const record = createPrivateMediationSafetyHoldRecord(owner);
  let journalRecord = null;

  assert.equal(await persistPrivateMediationSafetyHoldRecord(record, [
    async () => { throw new Error("secure store unavailable"); },
    async (value) => { journalRecord = value; },
  ]), true);
  assert.equal(journalRecord, record);
  assert.equal(await readPrivateMediationSafetyHoldStores(owner, [
    async () => null,
    async () => journalRecord,
  ]), true);
  assert.equal(await readPrivateMediationSafetyHoldStores(owner, [
    async () => null,
    async () => null,
  ]), false);
  assert.equal(await readPrivateMediationSafetyHoldStores(owner, [
    async () => { throw new Error("secure store unreadable"); },
    async () => null,
  ]), true);
});

test("all opaque device writes can fail only as an explicit fail-closed result", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000002",
    coupleId: "20000000-0000-4000-8000-000000000002",
  };
  const record = createPrivateMediationSafetyHoldRecord(owner);
  assert.equal(await persistPrivateMediationSafetyHoldRecord(record, [
    async () => { throw new Error("secure store unavailable"); },
    async () => { throw new Error("async storage unavailable"); },
  ]), false);
});

test("opaque device journals settle within a bound when one store never responds", async () => {
  const owner = {
    ownerUserId: "10000000-0000-4000-8000-000000000003",
    coupleId: "20000000-0000-4000-8000-000000000003",
  };
  const record = createPrivateMediationSafetyHoldRecord(owner);
  const never = () => new Promise(() => {});
  const deadline = (label) => new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(label), 100);
  });

  assert.equal(await Promise.race([
    persistPrivateMediationSafetyHoldRecord(record, [
      async () => undefined,
      never,
    ], { timeoutMs: 20 }),
    deadline("write-still-pending"),
  ]), true);
  assert.equal(await Promise.race([
    persistPrivateMediationSafetyHoldRecord(record, [
      async () => { throw new Error("primary unavailable"); },
      never,
    ], { timeoutMs: 20 }),
    deadline("failed-write-still-pending"),
  ]), false);

  assert.equal(await Promise.race([
    readPrivateMediationSafetyHoldStores(owner, [
      async () => record,
      never,
    ], { timeoutMs: 20 }),
    deadline("marker-read-still-pending"),
  ]), true);
  assert.equal(await Promise.race([
    readPrivateMediationSafetyHoldStores(owner, [
      async () => null,
      never,
    ], { timeoutMs: 20 }),
    deadline("missing-read-still-pending"),
  ]), true);
  assert.equal(await readPrivateMediationSafetyHoldStores(owner, [
    async () => null,
    async () => null,
  ], { timeoutMs: 20 }), false);
});

test("success requires an exact canonical receipt and a consumed card", () => {
  const request = buildMediationOutcomeBody(CARD, "blocked");
  const receipt = {
    id: "50000000-0000-4000-8000-000000000001",
    cardId: CARD.id,
    cardRevision: CARD.revision,
    sourceDigest: CARD.sourceDigest,
    outcome: "blocked",
    recordedAt: "2026-08-12T00:00:00.000Z",
    idempotencyKey: CARD.outcomeIdempotencyKey,
  };
  assert.deepEqual(matchCanonicalMediationOutcomeReceipt(receipt, { ...receipt }), receipt);
  assert.equal(matchCanonicalMediationOutcomeReceipt(receipt, {
    ...receipt,
    outcome: "resolved",
  }), null);
  assert.equal(isReceiptForMediationOutcomeRequest(receipt, request), true);
  assert.equal(isReceiptForMediationOutcomeRequest({
    ...receipt,
    sourceDigest: "b".repeat(64),
  }, request), false);
  assert.equal(isMediationOutcomeCardAdvanced(CARD, { state: "none" }), true);
  assert.equal(isMediationOutcomeCardAdvanced(CARD, {
    state: "ready",
    card: { ...CARD },
  }), false);
});

test("missing, failed, or corrupt mediation follow-up falls through without borrowing TodayOne state", () => {
  assert.equal(resolveMediationOutcomeSurface(404, null), "fallback");
  assert.equal(resolveMediationOutcomeSurface(200, "none"), "fallback");
  assert.equal(resolveMediationOutcomeSurface(200, "ready"), "ready");
  assert.equal(resolveMediationOutcomeSurface(503, null), "fallback");
  assert.equal(resolveMediationOutcomeSurface(200, null), "fallback");
});

test("mobile controller independently verifies POST, receipt reread, and card retirement", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraMediationOutcomeFollowUp.tsx"),
    "utf8",
  );
  assert.match(source, /validateMediationOutcomeFollowUpResponse/);
  assert.match(source, /validateMediationOutcomeFollowUpRequest/);
  assert.match(source, /validateMediationOutcomeFollowUpReceiptResponse/);
  assert.match(source, /apiFetchForExpectedUser/);
  assert.match(source, /\/api\/amora\/mediation\/follow-up/);
  assert.match(source, /\/api\/amora\/mediation\/follow-up\/outcomes/);
  assert.match(source, /idempotencyKey=\$\{encodeURIComponent/);
  assert.match(source, /matchCanonicalMediationOutcomeReceipt/);
  assert.match(source, /isMediationOutcomeCardAdvanced/);
  assert.match(source, /createFollowUpLifecycleCoordinator/);
  assert.match(source, /lifecycle\.beginOutcome\(captured\)/);
  assert.match(source, /lifecycle\.runStage/);
  assert.match(source, /supabase\.auth\.onAuthStateChange/);
  assert.match(source, /verifyFreshContext/);
  assert.match(source, /hasPrivateMediationSafetyHold/);
  assert.match(
    source,
    /if \(!current \|\| !isCurrentMediationOutcomeContext\(view\.context, current\)\) return null;/,
  );
  assert.match(source, /key=\{view\.card\.id\}/);
  assert.doesNotMatch(source, /TodayOne|amora_actions|stagePrivateChatHandoff/);
});

test("mobile chat seals an ephemeral private safety hold for the independent dashboard fence", async () => {
  const source = await readFile(
    resolve(HERE, "../../app/(tabs)/chat.tsx"),
    "utf8",
  );
  assert.match(source, /sealPrivateMediationSafetyHold/);
  assert.match(
    source,
    /if \(!hasLocalPrivateMediationSafetyHold[\s\S]*sealPrivateMediationSafetyHold\(\{/,
  );
  const storage = await readFile(
    resolve(HERE, "../lib/privateMediationSafetyHold.ts"),
    "utf8",
  );
  assert.match(storage, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /MOBILE_PRIVATE_SAFETY_HOLD_IO_TIMEOUT_MS\s*=\s*1_000/u);
  assert.match(
    storage,
    /createPrivateMediationSafetyHoldRuntime\([\s\S]*digestSha256:[\s\S]*Crypto\.digestStringAsync/u,
  );
  assert.match(storage, /return privateMediationSafetyHoldRuntime\.has\(owner\)/u);
  assert.doesNotMatch(storage, /rawText|summary|reason|partnerEmotion|partnerIntent/);

  const action = await readFile(
    resolve(HERE, "../components/dashboard/AmoraActionFollowUpV2.tsx"),
    "utf8",
  );
  const todayOne = await readFile(
    resolve(HERE, "../components/dashboard/TodayOneCareCard.tsx"),
    "utf8",
  );
  assert.doesNotMatch(action, /privateMediationSafetyHold/);
  assert.doesNotMatch(todayOne, /privateMediationSafetyHold/);
});

test("server-authoritative ephemeral safety seals the device before the card can be lost to a restart", async () => {
  // 서버가 ephemeral_safety로 답하는 경로(503/durable=false 포함)에서 카드는 화면에만
  // 있었다. 앱을 재시작하면 카드가 사라지는데 SecureStore 홀드도 DB 홀드도 없으므로,
  // 안전 보류가 있었다는 사실 자체가 기기에서 증발한다. 그 상태에서 선택형 후속이
  // 다시 자격을 얻는다.
  //
  // 계약: 서버 권위 안전 분기는 **반환 전에** 기기/프로세스 seal을 남긴다. 원격 seal이
  // 실패해도 로컬 홀드는 남아야 재시작이 안전 보류를 지운 것처럼 되지 않는다.
  const source = await readFile(
    resolve(HERE, "../../app/(tabs)/chat.tsx"),
    "utf8",
  );

  const branches = [...source.matchAll(/ingestResult\.outcome === "ephemeral_safety"/gu)]
    .map((match) => source.slice(match.index, match.index + 3_500));
  assert.ok(
    branches.length >= 2,
    `서버 권위 ephemeral_safety 분기를 찾지 못했다 (${branches.length}개)`,
  );
  for (const [index, branch] of branches.entries()) {
    assert.match(
      branch,
      /sealPrivateMediationSafetyHold\(\{/u,
      `서버 권위 안전 분기 ${index + 1}이 기기 seal 없이 반환한다`,
    );
    const sealIndex = branch.indexOf("const localSafetyHoldWrite = sealPrivateMediationSafetyHold");
    const renderIndex = branch.indexOf("setMessages");
    const deviceWriteIndex = branch.indexOf("await localSafetyHoldWrite");
    const returnIndex = branch.indexOf("return;", deviceWriteIndex);
    assert.ok(
      sealIndex >= 0
        && renderIndex > sealIndex
        && deviceWriteIndex > renderIndex
        && returnIndex > deviceWriteIndex,
      `서버 권위 안전 분기 ${index + 1}은 즉시 안내 후 기기 저장을 마치기 전에 반환한다`,
    );
    assert.match(
      branch,
      /durable_safety_fence_confirmed:\s*ingestResult\.durableSafetyFenceConfirmed/u,
    );
  }

  // seal 인자에는 소유자와 커플만 넣는다. 원문·분류·요약이 들어가면 기기 저장소로 샌다.
  for (const call of source.matchAll(/sealPrivateMediationSafetyHold\(\{([\s\S]{0,240}?)\}\)/gu)) {
    const args = call[1];
    assert.doesNotMatch(
      args,
      /content|response|rawText|summary|reason|classification|disclosure/u,
      `seal 인자에 내용이 실린다: ${args.trim()}`,
    );
  }
});

test("recipient-private card keeps bounded choices accessible without free text or automatic mediation", async () => {
  const source = await readFile(
    resolve(HERE, "../components/dashboard/AmoraMediationOutcomeCard.tsx"),
    "utf8",
  );
  for (const label of ["이제 괜찮아졌어요", "상황이 달라졌어요", "아직 막혀 있어요", "여기서 멈출게요"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /나에게만 저장돼요/);
  assert.match(source, /공동 기록과 상대방 카드에는 영향을 주지 않아요/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityLiveRegion="polite"/);
  assert.match(source, /minHeight:\s*44/);
  assert.doesNotMatch(source, /TextInput|재중재|상대 감정|상대 의도/);
});

test("dashboard keeps mediation in both urgent-action and ordinary-care fallback chains", async () => {
  const source = await readFile(
    resolve(HERE, "../../app/(tabs)/dashboard.tsx"),
    "utf8",
  );
  assert.match(source, /<AmoraMediationOutcomeFollowUp/);
  assert.match(source, /loadingFallback=\{companionFallback\}/);
  assert.match(
    source,
    /fallback=\{todayOneCare\}/,
  );
  assert.match(source, /fallback=\{todayOneBeforeOrdinaryAction\}/);
  assert.match(source, /focus\.claimBeforeCare[\s\S]*renderActionCare\(mediatedCare\)/);
  assert.match(source, /expectedOwnerUserId=\{data\.ownerUserId\}/);
  assert.match(source, /expectedCoupleId=\{data\.coupleId\}/);
});
