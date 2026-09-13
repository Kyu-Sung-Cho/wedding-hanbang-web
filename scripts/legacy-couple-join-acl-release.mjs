#!/usr/bin/env node
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LEGACY_JOIN_ACL_RELEASE_ID, buildLegacyJoinAclSql, createLegacyJoinManagementClient, runLegacyJoinAcl, validateLegacyJoinConnection } from "./lib/legacy-couple-join-acl-release.mjs";

const [mode, receiptPath, ...extra] = process.argv.slice(2);
let client;
try {
  if (!["inspect", "apply", "rehearse", "rollback"].includes(mode) || !receiptPath || extra.length) throw new Error("JOIN_ACL_ARGUMENTS_INVALID");
  const expectedRef = process.env.JOIN_ACL_PROJECT_REF;
  const connectionString = process.env.JOIN_ACL_DATABASE_URL;
  const transport = process.env.JOIN_ACL_TRANSPORT ?? "direct";
  if (transport === "direct") {
    validateLegacyJoinConnection(connectionString, expectedRef);
    client = new Client({ connectionString, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  } else if (transport === "management") {
    client = createLegacyJoinManagementClient({ accessToken: process.env.SUPABASE_ACCESS_TOKEN, expectedRef, mode, confirmation: process.env.JOIN_ACL_CONFIRMATION });
  } else throw new Error("JOIN_ACL_TRANSPORT_INVALID");
  // 성공 기록을 덮어쓰거나 기록 경로가 잘못된 상태에서 운영 쓰기부터 시작하지 않는다.
  writeFileSync(receiptPath, JSON.stringify({ releaseId: LEGACY_JOIN_ACL_RELEASE_ID, status: "started", mode, expectedRef, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  await client.connect?.();
  const result = await runLegacyJoinAcl({ client, mode, expectedRef, confirmation: process.env.JOIN_ACL_CONFIRMATION, beforeMutation: before => writeFileSync(receiptPath, JSON.stringify({ releaseId: LEGACY_JOIN_ACL_RELEASE_ID, status: "prepared-outcome-unverified", mode, expectedRef, preparedAt: new Date().toISOString(), before }, null, 2)) });
  writeFileSync(receiptPath, JSON.stringify({ releaseId: LEGACY_JOIN_ACL_RELEASE_ID, mode, transport, expectedRef, completedAt: new Date().toISOString(), sqlSha256: mode === "inspect" ? null : createHash("sha256").update(buildLegacyJoinAclSql(mode)).digest("hex"), ...result }, null, 2));
  process.stdout.write(`JOIN_ACL_VERIFIED: ${result.status}\n`);
} catch (error) {
  const code = /^JOIN_ACL_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "JOIN_ACL_UNVERIFIED_INSPECT_BEFORE_RETRY";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally { if (client?.end) await client.end().catch(() => {}); }
