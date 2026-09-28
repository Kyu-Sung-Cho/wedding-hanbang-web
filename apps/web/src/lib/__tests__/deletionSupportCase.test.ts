// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueDeletionSupportProof } from "../accountDeletion/supportProof";
import { advanceDeletionSupportCase, getDeletionSupportCaseEventCount, prepareDeletionSupportCase, validateDeletionSupportCase,
  validateDeletionSupportCaseTransition, validateSupportExecutionObservation, validateSupportRuntimeState,
  type DeletionSupportCase, type SupportCaseDependencies, type SupportJob } from "../accountDeletion/supportCase";

const projectRef = "abcdefghijklmnopqrst";
const subject = "10000000-0000-4000-8000-000000000001";
const caseId = "20000000-0000-4000-8000-000000000002";
const jobId = "30000000-0000-4000-8000-000000000003";
const secret = "support-case-test-secret-never-a-live-secret";
const now = Date.parse("2026-09-13T09:00:00Z");
function fixture() {
  const proof = issueDeletionSupportProof({ projectRef, subject, secret, now });
  const input = { projectRef, secret, caseId, proof: proof.proof, now, operator: "support-test",
    requestText: `본인 계정의 회원 탈퇴 처리를 요청합니다.\n${proof.proof}`,
    confirmation: `REVIEWED_ACCOUNT_DELETION_REQUEST:${caseId}:${proof.reference}` };
  return { input, value: prepareDeletionSupportCase(input) };
}
function harness(overrides: Partial<SupportCaseDependencies> = {}) {
  let job: SupportJob = { id: jobId, userId: subject, status: "inventorying", claimToken: null,
    storageVerifiedAt: null, authDeletedAt: null, completedAt: null };
  const saved: DeletionSupportCase[] = [];
  const deps: SupportCaseDependencies = {
    persist: vi.fn(async v => { saved.push(structuredClone(v)); }),
    enqueue: vi.fn(async () => {}),
    findActiveJobs: vi.fn(async () => [job]),
    readJob: vi.fn(async () => job),
    process: vi.fn<SupportCaseDependencies["process"]>(async () => ({ status: "pending" })),
    verifyAccountAbsence: vi.fn(async () => false), now: () => now,
    ...overrides,
  };
  return { deps, saved, changeJob: (change: Partial<SupportJob>) => { job = { ...job, ...change }; } };
}

function legacyCaseAtHistoryLimit(count: 99 | 100): DeletionSupportCase {
  const value = fixture().value;
  const at = new Date(now).toISOString();
  const events: DeletionSupportCase["events"] = [value.events[0],
    { at, state: "enqueue-unverified", jobId: null },
    { at, state: "queued", jobId }];
  while (events.length < count) {
    events.push({ at, state: events.length % 2 === 1 ? "process-unverified" : "pending", jobId });
  }
  return { ...value, format: "hanbang-deletion-support-case-v1", history: undefined,
    jobId, state: count === 100 ? "process-unverified" : "pending", events };
}
describe("지원 사건은 실제 요청·본인·exact job을 묶는다", () => {
  it("새 read-only runtime 응답은 정확 commit·30초·두 false 값만 허용한다", () => {
    const commit = "c".repeat(40);
    const state = { commit, observedAt: new Date(now).toISOString(), flags: {
      ACCOUNT_DELETION_INTAKE_ENABLED: false, ACCOUNT_DELETION_CRON_ENABLED: false } };
    expect(() => validateSupportRuntimeState(state, commit, now)).not.toThrow();
    for (const changed of [{ ...state, commit: null }, { ...state, commit: "d".repeat(40) },
      { ...state, extra: true }, { ...state, flags: {} }, { ...state, flags: { ...state.flags, ACCOUNT_DELETION_CRON_ENABLED: true } },
      { ...state, flags: { ...state.flags, ACCOUNT_DELETION_INTAKE_ENABLED: "false" } }]) {
      expect(() => validateSupportRuntimeState(changed, commit, now)).toThrow();
    }
    expect(() => validateSupportRuntimeState(state, commit, now + 30_000)).toThrow();
    expect(() => validateSupportRuntimeState(state, commit, now - 1)).toThrow();
  });
  it("실행 직전에도 flags 관측 만료·다른 배포·자동 실행 활성화를 거절한다", () => {
    const commit = "a".repeat(40);
    const flags = { format: "w12-production-flags-observation-v1", source: "vercel-production-environment-read",
      deploymentTarget: "production", productionCommit: commit, deploymentId: "dpl_test", observedAt: new Date(now).toISOString(),
      flags: ["ACCOUNT_DELETION_INTAKE_ENABLED", "ACCOUNT_DELETION_CRON_ENABLED"].map(name => ({ name, present: false, value: null })) };
    expect(() => validateSupportExecutionObservation(flags, commit, now)).not.toThrow();
    expect(() => validateSupportExecutionObservation(flags, commit, now + 300_000)).toThrow();
    expect(() => validateSupportExecutionObservation(flags, commit, now - 1)).toThrow();
    expect(() => validateSupportExecutionObservation(flags, "b".repeat(40), now)).toThrow();
    expect(() => validateSupportExecutionObservation({ ...flags, flags: flags.flags.map(f => ({ ...f, present: true, value: "true" })) }, commit, now)).toThrow();
    expect(() => validateSupportExecutionObservation({ ...flags, flags: [flags.flags[0], flags.flags[0]] }, commit, now)).toThrow();
  });
  it("발급만으로 접수·전체 삭제 완료를 주장하지 않고 원문 hash를 보존한다", () => {
    const { value } = fixture();
    expect(value).toMatchObject({ subject, caseId, state: "prepared", jobId: null, generalCustomerDataRemovalVerified: false });
    expect(value.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(value)).not.toContain("HBDEL1");
  });
  it("단순 verified 플래그, 다른 문의의 코드, 원문 없는 코드는 접수 근거가 아니다", () => {
    const { input } = fixture();
    expect(() => prepareDeletionSupportCase({ ...input, confirmation: "verified:true" })).toThrow("REQUEST_REVIEW_REQUIRED");
    expect(() => prepareDeletionSupportCase({ ...input, requestText: "다른 사람의 탈퇴 요청입니다." })).toThrow("ORIGINAL_REQUEST_REQUIRED");
    expect(() => prepareDeletionSupportCase({ ...input, requestText: input.proof })).toThrow("ORIGINAL_REQUEST_REQUIRED");
  });
  it("서명된 본인 ID를 입력한 임의 계정으로 바꿀 수 없다", () => {
    const { input } = fixture();
    expect(() => prepareDeletionSupportCase({ ...input, projectRef: "zyxwvutsrqponmlkjihg" })).toThrow();
    expect(() => validateDeletionSupportCase({ ...fixture().value, subject: "not-an-id" }, projectRef)).toThrow();
  });
  it("접수 전 영속 기록 실패는 실제 RPC를 막는다", async () => {
    const h = harness({ persist: vi.fn(async () => { throw new Error("disk full"); }) });
    await expect(advanceDeletionSupportCase(fixture().value, "enqueue", h.deps)).rejects.toThrow("disk full");
    expect(h.deps.enqueue).not.toHaveBeenCalled();
  });
  it("접수 응답 유실 후 inspect만으로 같은 소유자의 exact job을 회수한다", async () => {
    const h = harness({ enqueue: vi.fn(async () => { throw new Error("response lost"); }) });
    await expect(advanceDeletionSupportCase(fixture().value, "enqueue", h.deps)).rejects.toThrow("response lost");
    expect(h.saved.at(-1)?.state).toBe("enqueue-unverified");
    const recovered = await advanceDeletionSupportCase(h.saved.at(-1)!, "inspect", h.deps);
    expect(recovered).toMatchObject({ jobId, state: "queued" });
    expect(h.deps.enqueue).toHaveBeenCalledTimes(1);
    expect(h.deps.process).not.toHaveBeenCalled();
  });
  it("대상 소유자 불일치·복수 active job은 추측해 채택하지 않는다", async () => {
    const h = harness(); h.changeJob({ userId: caseId });
    await expect(advanceDeletionSupportCase(fixture().value, "enqueue", h.deps)).rejects.toThrow("OWNER_MISMATCH");
    expect(h.saved).toHaveLength(1);
    const h2 = harness({ findActiveJobs: vi.fn(async () => []) });
    await expect(advanceDeletionSupportCase(fixture().value, "enqueue", h2.deps)).rejects.toThrow("ACTIVE_JOB_UNVERIFIED");
  });
  it("job 연결 기록이 실패하면 파괴 단계에 들어가지 않는다", async () => {
    const h = harness();
    h.deps.persist = vi.fn(async v => { if (v.jobId) throw new Error("durability failed"); h.saved.push(v); });
    await expect(advanceDeletionSupportCase(fixture().value, "enqueue", h.deps)).rejects.toThrow("durability failed");
    expect(h.deps.process).not.toHaveBeenCalled();
  });
  it("동일 사건을 반복 접수하거나 처리 미확정 상태에서 자동 재실행하지 않는다", async () => {
    const h = harness(); const queued = await advanceDeletionSupportCase(fixture().value, "enqueue", h.deps);
    await expect(advanceDeletionSupportCase(queued, "enqueue", h.deps)).rejects.toThrow("INSPECT_FIRST");
    h.deps.process = vi.fn(async () => { throw new Error("response lost"); });
    await expect(advanceDeletionSupportCase(queued, "process", h.deps)).rejects.toThrow("response lost");
    await expect(advanceDeletionSupportCase(h.saved.at(-1)!, "process", h.deps)).rejects.toThrow("INSPECT_FIRST");
    expect(h.deps.process).toHaveBeenCalledTimes(1);
  });
  it("다른 worker가 claim 중이거나 manual review이면 강제 진행하지 않는다", async () => {
    const h = harness(); const queued = await advanceDeletionSupportCase(fixture().value, "enqueue", h.deps);
    h.changeJob({ claimToken: caseId });
    await expect(advanceDeletionSupportCase(queued, "process", h.deps)).rejects.toThrow("WORKER_BUSY");
    h.changeJob({ claimToken: null, status: "manual_review" });
    const result = await advanceDeletionSupportCase(queued, "process", h.deps);
    expect(result.state).toBe("manual_review"); expect(h.deps.process).not.toHaveBeenCalled();
  });
  it("Auth 삭제 후 finalize 실패도 저장한 같은 job으로 inspect와 재개한다", async () => {
    const h = harness(); const queued = await advanceDeletionSupportCase(fixture().value, "enqueue", h.deps);
    h.changeJob({ status: "auth_deleting" });
    h.deps.process = vi.fn(async () => { throw new Error("finalize timeout"); });
    await expect(advanceDeletionSupportCase(queued, "process", h.deps)).rejects.toThrow("finalize timeout");
    const inspected = await advanceDeletionSupportCase(h.saved.at(-1)!, "inspect", h.deps);
    h.deps.process = vi.fn<SupportCaseDependencies["process"]>(async () => {
      h.changeJob({ status: "completed", userId: null, storageVerifiedAt: new Date(now).toISOString(),
        authDeletedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString() });
      return { status: "completed" };
    });
    h.deps.verifyAccountAbsence = vi.fn(async () => true);
    const result = await advanceDeletionSupportCase(inspected, "process", h.deps);
    expect(h.deps.process).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(result).toMatchObject({ state: "scope_review_required", generalCustomerDataRemovalVerified: false });
  });
  it("완료 응답이 와도 원장·Auth/profile 부재가 확인 안 되면 완료라 하지 않는다", async () => {
    const h = harness({ process: vi.fn<SupportCaseDependencies["process"]>(async () => ({ status: "completed" })) });
    const queued = await advanceDeletionSupportCase(fixture().value, "enqueue", h.deps);
    expect((await advanceDeletionSupportCase(queued, "process", h.deps)).state).toBe("pending");
    h.changeJob({ status: "completed", userId: null });
    await expect(advanceDeletionSupportCase(queued, "inspect", h.deps)).rejects.toThrow("COMPLETION_UNVERIFIED");
    h.changeJob({ storageVerifiedAt: new Date(now).toISOString(), authDeletedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString() });
    await expect(advanceDeletionSupportCase(queued, "inspect", h.deps)).rejects.toThrow("COMPLETION_UNVERIFIED");
  });
  it("다른 job으로 바뀐 readback과 완료 속성 위조를 거절한다", async () => {
    const h = harness(); const queued = await advanceDeletionSupportCase(fixture().value, "enqueue", h.deps);
    h.changeJob({ id: caseId });
    await expect(advanceDeletionSupportCase(queued, "inspect", h.deps)).rejects.toThrow("JOB_MISMATCH");
    expect(() => validateDeletionSupportCase({ ...queued, generalCustomerDataRemovalVerified: true }, projectRef)).toThrow();
    expect(() => validateDeletionSupportCase({ ...queued, jobId: caseId }, projectRef)).toThrow();
  });
  it("기존 100개 이력에서 미확정 처리를 조회한 뒤 같은 작업을 재개한다", async () => {
    const h = harness();
    const legacy = legacyCaseAtHistoryLimit(100);
    validateDeletionSupportCase(legacy, projectRef);

    const inspected = await advanceDeletionSupportCase(legacy, "inspect", h.deps);
    expect(inspected.state).toBe("pending");
    expect(h.deps.process).not.toHaveBeenCalled();
    const resumed = await advanceDeletionSupportCase(inspected, "process", h.deps);
    expect(resumed).toMatchObject({ jobId, state: "pending", requestSha256: legacy.requestSha256 });
    expect(resumed.events[0]).toEqual(legacy.events[0]);
    expect(resumed.events.length).toBeLessThanOrEqual(100);
    expect(h.deps.process).toHaveBeenCalledExactlyOnceWith(jobId);
  });
  it("99개 이력에서 시작한 처리의 결과까지 영속화하고 재시도할 수 있다", async () => {
    const h = harness();
    const legacy = legacyCaseAtHistoryLimit(99);
    const result = await advanceDeletionSupportCase(legacy, "process", h.deps);
    expect(result.state).toBe("pending");
    expect(h.saved.at(-1)).toEqual(result);
    expect(result.events[0]).toEqual(legacy.events[0]);
    expect(result.events.length).toBeLessThanOrEqual(100);
    await expect(advanceDeletionSupportCase(result, "process", h.deps)).resolves.toMatchObject({ state: "pending" });
    expect(h.deps.process).toHaveBeenCalledTimes(2);
  });
  it("큰 파일 목록과 반복 대기를 처리해도 활성 이력과 메모리 크기가 계속 늘지 않는다", async () => {
    const h = harness();
    const prepared = fixture().value;
    let current = await advanceDeletionSupportCase(prepared, "enqueue", h.deps);
    for (let attempt = 0; attempt < 600; attempt++) {
      current = await advanceDeletionSupportCase(current, "process", h.deps);
      expect(current.events.length).toBeLessThanOrEqual(100);
      expect(Buffer.byteLength(JSON.stringify(current))).toBeLessThan(32 * 1024);
      expect(current.events[0]).toEqual(prepared.events[0]);
      validateDeletionSupportCase(current, projectRef);
    }
    expect(current).toMatchObject({ state: "pending", jobId, requestSha256: prepared.requestSha256,
      generalCustomerDataRemovalVerified: false });
    expect(h.deps.process).toHaveBeenCalledTimes(600);

    // 활성 창에서 빠진 원문도 앞선 append-only journal 레코드에서 전부 복원된다.
    const journal = [prepared, ...h.saved];
    const fullHistory = journal.map((entry, index) => {
      validateDeletionSupportCaseTransition(index === 0 ? null : journal[index - 1], entry);
      return entry.events[entry.events.length - 1];
    });
    expect(fullHistory).toHaveLength(1203);
    expect(current.events).toEqual([fullHistory[0], ...fullHistory.slice(-99)]);
    let archivedSha256: string | null = null;
    for (const event of fullHistory.slice(1, -99)) {
      archivedSha256 = createHash("sha256").update(JSON.stringify([archivedSha256, event])).digest("hex");
    }
    expect(current).toMatchObject({ format: "hanbang-deletion-support-case-v2",
      history: { totalEvents: 1203, archivedEvents: 1103, archivedSha256 } });
  });
  it("기존 journal을 검증하고 100번째 이후 버전 전환에서 빠진 원문을 연결한다", async () => {
    const legacy = legacyCaseAtHistoryLimit(100);
    for (let count = 1; count <= 100; count++) {
      const events = legacy.events.slice(0, count);
      const last = events[events.length - 1];
      const next: DeletionSupportCase = { ...legacy, state: last.state, jobId: last.jobId, events };
      const previousLast = legacy.events[count - 2];
      const previous: DeletionSupportCase | null = count === 1 ? null : {
        ...legacy, state: previousLast.state, jobId: previousLast.jobId, events: legacy.events.slice(0, count - 1),
      };
      expect(() => validateDeletionSupportCaseTransition(previous, next)).not.toThrow();
      expect(getDeletionSupportCaseEventCount(next)).toBe(count);
    }
    const before = structuredClone(legacy);
    const h = harness();
    const next = await advanceDeletionSupportCase(legacy, "inspect", h.deps);
    expect(next).toMatchObject({ format: "hanbang-deletion-support-case-v2", history: {
      totalEvents: 101, archivedEvents: 1,
      archivedSha256: createHash("sha256").update(JSON.stringify([null, legacy.events[1]])).digest("hex"),
    } });
    expect(legacy).toEqual(before);
    expect(() => validateDeletionSupportCaseTransition(legacy, next)).not.toThrow();
    expect(() => validateDeletionSupportCaseTransition(null, next)).toThrow("HISTORY_INVALID");
  });
  it.each(["hash", "count", "prefix", "first", "owner", "job", "skip", "reorder"])(
    "journal 전이에서 %s 위조를 거절한다", async (kind) => {
      const legacy = legacyCaseAtHistoryLimit(100);
      const next = await advanceDeletionSupportCase(legacy, "inspect", harness().deps);
      if (next.format !== "hanbang-deletion-support-case-v2") throw new Error("Expected v2 history");
      if (kind === "hash") next.history.archivedSha256 = "a".repeat(64);
      if (kind === "count") { next.history.totalEvents++; next.history.archivedEvents++; }
      if (kind === "prefix") next.events[1].state = "manual_review";
      if (kind === "first") next.events[0].at = new Date(now + 1).toISOString();
      if (kind === "owner") next.subject = caseId;
      if (kind === "job") {
        next.jobId = caseId;
        next.events = next.events.map(event => ({ ...event, jobId: event.jobId === null ? null : caseId }));
      }
      if (kind === "skip") next.events.splice(1, 1);
      if (kind === "reorder") [next.events[1], next.events[2]] = [next.events[2], next.events[1]];
      expect(() => validateDeletionSupportCaseTransition(legacy, next)).toThrow("HISTORY_INVALID");
    },
  );
  it("v2를 옛 형식으로 되돌리거나 메타데이터를 빼서 감사 카운트를 초기화할 수 없다", async () => {
    const prepared = fixture().value;
    const h = harness();
    await advanceDeletionSupportCase(prepared, "enqueue", h.deps);
    const next = h.saved[0];
    expect(() => validateDeletionSupportCaseTransition(prepared, {
      ...next, format: "hanbang-deletion-support-case-v1", history: undefined,
    })).toThrow("HISTORY_INVALID");
    const missingHistory = structuredClone(next);
    Reflect.deleteProperty(missingHistory, "history");
    expect(() => validateDeletionSupportCase(missingHistory, projectRef)).toThrow("HISTORY_INVALID");
  });
  it("숫자 한계에서 처리 전후 두 기록을 남길 수 없으면 원격 조회·처리 전에 멈춘다", async () => {
    const h = harness();
    const legacy = legacyCaseAtHistoryLimit(99);
    const full = await advanceDeletionSupportCase(legacy, "process", h.deps);
    if (full.format !== "hanbang-deletion-support-case-v2") throw new Error("Expected v2 history");
    full.history = { totalEvents: Number.MAX_SAFE_INTEGER - 1,
      archivedEvents: Number.MAX_SAFE_INTEGER - 101, archivedSha256: "a".repeat(64) };
    validateDeletionSupportCase(full, projectRef);
    const bounded = harness();
    await expect(advanceDeletionSupportCase(full, "process", bounded.deps)).rejects.toThrow("HISTORY_LIMIT");
    expect(bounded.deps.persist).not.toHaveBeenCalled();
    expect(bounded.deps.readJob).not.toHaveBeenCalled();
    expect(bounded.deps.process).not.toHaveBeenCalled();
  });
  it("100개 이후에도 응답 유실 시 조회 없이 파괴 단계를 다시 실행하지 않는다", async () => {
    const h = harness();
    const inspected = await advanceDeletionSupportCase(legacyCaseAtHistoryLimit(100), "inspect", h.deps);
    h.deps.process = vi.fn(async () => { throw new Error("response lost"); });
    await expect(advanceDeletionSupportCase(inspected, "process", h.deps)).rejects.toThrow("response lost");
    const unverified = h.saved.at(-1)!;
    expect(unverified).toMatchObject({ state: "process-unverified", history: { totalEvents: 102 } });
    await expect(advanceDeletionSupportCase(unverified, "process", h.deps)).rejects.toThrow("INSPECT_FIRST");
    const recovered = await advanceDeletionSupportCase(unverified, "inspect", h.deps);
    expect(recovered).toMatchObject({ state: "pending", history: { totalEvents: 103 } });
    expect(h.deps.process).toHaveBeenCalledTimes(1);
  });
});
