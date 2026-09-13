// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { issueDeletionSupportProof } from "../accountDeletion/supportProof";
import { advanceDeletionSupportCase, prepareDeletionSupportCase, validateDeletionSupportCase, validateSupportExecutionObservation, validateSupportRuntimeState,
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
});
