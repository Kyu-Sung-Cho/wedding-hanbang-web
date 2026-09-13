// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { validateSupportRuntimeState } from "@/lib/accountDeletion/supportCase";

const SHA = "a".repeat(40);
const PROJECT = "slrtobkksjmxgzatjyqb";
const STATE = "synthetic-readonly-state";
const CRON = "synthetic-cron-only";
const value = { caseId: "11111111-1111-4111-8111-111111111111", subject: "22222222-2222-4222-8222-222222222222", state: "prepared" };
const recordHash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
const source = readFileSync(resolve(process.cwd(), "../../scripts/account-deletion-support.mjs"), "utf8");
// Execute the real CLI branch with only its imported dependencies and remote transport replaced.
const program = source.replace(/^import .+;\r?\n/gm, "").replaceAll("import.meta.url", '"file:///synthetic/scripts/account-deletion-support.mjs"');

async function run(env: Record<string, string | undefined>, status = 200) {
  const network: Array<{ url: string; authorization: string | undefined }> = [];
  const output: string[] = [];
  const requestDeletion = vi.fn(async () => ({ status: "pending" }));
  const close = vi.fn();
  const childEnv: Record<string, string | undefined> = { ...env, SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only" };
  const state = {
    env: childEnv, exitCode: undefined as number | undefined,
    argv: ["node", "support-cli", "--mode=enqueue", `--case-id=${value.caseId}`, `--expected-commit=${SHA}`, `--confirm=enqueue:${value.caseId}:${recordHash}`],
    stdout: { write: (text: string) => output.push(text) }, stderr: { write: (text: string) => output.push(text) },
  };
  const admin = { marker: "synthetic-admin-client" };
  const createClient = vi.fn(() => admin);
  const operation = runInNewContext(`(async () => { ${program} })()`, {
    process: state, Buffer, URL, Request, AbortSignal, createHash, fileURLToPath: () => "/synthetic/",
    execFileSync: (_command: string, args: string[]) => args.includes("HEAD") ? SHA
      : args.includes("origin") ? "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git" : "",
    verifySupabaseServiceDestinationFromEnv: () => ({ projectRef: PROJECT, url: `https://${PROJECT}.supabase.co` }),
    openDeletionSupportStore: () => ({ latest: value, persist: vi.fn(), close }), createClient,
    tsImport: async (path: string) => path.includes("communityStorageSaga")
      ? { requestAccountDeletion: requestDeletion }
      : { validateDeletionSupportCase: vi.fn(), validateSupportRuntimeState,
        advanceDeletionSupportCase: async (current: typeof value, _mode: string, deps: { enqueue: (id: string) => Promise<void> }) => {
          await deps.enqueue(current.subject); return current;
        } },
    fetch: async (resource: string, init: { headers?: { Authorization?: string } }) => {
      network.push({ url: resource, authorization: init?.headers?.Authorization });
      if (resource === "https://hanbang.ai/api/health") return new Response(JSON.stringify({ ok: true, database: "up", commit: SHA.slice(0, 12) }));
      if (resource !== "https://hanbang.ai/api/ops/account-deletion-state") throw Error("Unexpected network destination");
      return new Response(JSON.stringify({ commit: SHA, observedAt: new Date().toISOString(), flags: {
        ACCOUNT_DELETION_INTAKE_ENABLED: false, ACCOUNT_DELETION_CRON_ENABLED: false,
      } }), { status, headers: { "cache-control": "private, no-store" } });
    },
  }, { timeout: 1_000 });
  await operation;
  return { network, output: output.join(""), requestDeletion, state, admin, createClient, close };
}

describe("support CLI separate runtime-state credential", () => {
  it.each([undefined, CRON])("uses the state credential only on the read endpoint and keeps service/cron credentials separate: %s", async cron => {
    const result = await run({ ACCOUNT_DELETION_STATE_SECRET: STATE, CRON_SECRET: cron });
    expect(result.state.exitCode).toBeUndefined();
    expect(result.network.filter(x => x.authorization !== undefined)).toEqual([
      { url: "https://hanbang.ai/api/ops/account-deletion-state", authorization: `Bearer ${STATE}` },
    ]);
    expect(result.createClient).toHaveBeenCalledWith(`https://${PROJECT}.supabase.co`, "synthetic-service-only", expect.any(Object));
    expect(result.requestDeletion).toHaveBeenCalledWith(result.admin, value.subject, "privacy", expect.any(Number), { processImmediately: false });
    expect(result.state.env.CRON_SECRET).toBe(cron);
    expect(result.output).not.toContain(STATE);
    expect(result.output).not.toContain("synthetic-service-only");
    expect(result.close).toHaveBeenCalledOnce();
  });

  it.each([undefined, "", "  "])("falls back to the legacy cron credential only when state credential is absent: %s", async secret => {
    const result = await run({ ACCOUNT_DELETION_STATE_SECRET: secret, CRON_SECRET: CRON });
    expect(result.state.exitCode).toBeUndefined();
    expect(result.network.at(-1)?.authorization).toBe(`Bearer ${CRON}`);
  });

  it.each([{}, { ACCOUNT_DELETION_STATE_SECRET: " ", CRON_SECRET: "" }])("refuses absent credentials before any network or worker action", async env => {
    const result = await run(env);
    expect(result.state.exitCode).toBe(2);
    expect(result.output).toContain("SUPPORT_CASE_RUNTIME_CREDENTIAL_REQUIRED");
    expect(result.network).toHaveLength(0);
    expect(result.requestDeletion).not.toHaveBeenCalled();
  });

  it("does not retry a rejected state credential with the more powerful cron credential", async () => {
    const result = await run({ ACCOUNT_DELETION_STATE_SECRET: STATE, CRON_SECRET: CRON }, 401);
    expect(result.state.exitCode).toBe(2);
    expect(result.output).toContain("SUPPORT_CASE_RUNTIME_STATE_UNAVAILABLE");
    expect(result.network.filter(x => x.authorization !== undefined)).toEqual([
      { url: "https://hanbang.ai/api/ops/account-deletion-state", authorization: `Bearer ${STATE}` },
    ]);
    expect(result.requestDeletion).not.toHaveBeenCalled();
  });
});
