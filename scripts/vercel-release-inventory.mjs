#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 2;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const ENVELOPE_KEYS = new Set(["project", "env", "deployments"]);
const TARGET_ORDER = ["development", "preview", "production"];
const ENV_TYPES = new Set(["plain", "encrypted", "sensitive", "secret", "system"]);
const FRAMEWORKS = new Set([
  "nextjs",
  "vite",
  "nuxtjs",
  "sveltekit",
  "remix",
  "astro",
  "other",
]);
const PROTECTION_MODES = new Set([
  "all_except_custom_domains",
  "all_deployments",
  "preview",
  "standard",
  "none",
]);
const DEPLOYMENT_STATES = new Set([
  "READY",
  "BUILDING",
  "ERROR",
  "CANCELED",
  "CANCELLED",
  "QUEUED",
  "INITIALIZING",
  "BLOCKED",
]);
const ERROR_CODES = new Set([
  "ARGUMENTS_INVALID",
  "INPUT_JSON_INVALID",
  "INPUT_SHAPE_INVALID",
  "INPUT_TOP_LEVEL_REJECTED",
  "INPUT_TOO_LARGE",
  "LOCAL_FIXTURE_READ_FAILED",
  "INTERNAL_ERROR",
]);

class InventoryError extends Error {
  constructor(code) {
    super(code);
    this.code = ERROR_CODES.has(code) ? code : "INTERNAL_ERROR";
  }
}

function fail(code) {
  throw new InventoryError(code);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownNonNullValues(record, keys) {
  if (!isRecord(record)) fail("INPUT_SHAPE_INVALID");
  return keys
    .filter((key) => Object.hasOwn(record, key)
      && record[key] !== null
      && record[key] !== undefined)
    .map((key) => record[key]);
}

function normalizeConsistentAliases(values, normalizer, {
  required = false,
  fallback = null,
} = {}) {
  if (!Array.isArray(values)) fail("INPUT_SHAPE_INVALID");
  const normalized = values.map((value) => {
    const result = normalizer(value);
    if (result === null || result === undefined) fail("INPUT_SHAPE_INVALID");
    return result;
  });
  if (required && normalized.length === 0) fail("INPUT_SHAPE_INVALID");
  const identities = new Set(normalized.map((value) => canonicalStringify(value)));
  if (identities.size > 1) fail("INPUT_SHAPE_INVALID");
  return normalized[0] ?? fallback;
}

function safeIdentifier(value, maxLength = 128) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : null;
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function safeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("..")) return null;
  return value;
}

function safeGitRef(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) return null;
  if (value.includes("..") || value.includes("@{") || value.endsWith("/")) return null;
  return value;
}

function safeNodeVersion(value) {
  if (typeof value !== "string" || value.length > 32) return null;
  return /^\d+(?:\.(?:\d+|x)){0,2}$/.test(value) ? value : null;
}

function safeFramework(value) {
  return typeof value === "string" && FRAMEWORKS.has(value) ? value : null;
}

function safeProjectId(value) {
  return typeof value === "string" && /^prj_[A-Za-z0-9]{28}$/.test(value)
    ? value
    : null;
}

function safeAccountId(value) {
  return typeof value === "string" && /^(?:team|user)_[A-Za-z0-9]{24}$/.test(value)
    ? value
    : null;
}

function normalizeGitDeployments(project) {
  const values = [];
  for (const [containerName, key] of [
    ["gitProviderOptions", "createDeployments"],
    ["git", "deploymentEnabled"],
  ]) {
    if (Object.hasOwn(project, containerName)
      && project[containerName] !== null
      && project[containerName] !== undefined) {
      if (!isRecord(project[containerName])) fail("INPUT_SHAPE_INVALID");
      values.push(...ownNonNullValues(project[containerName], [key]));
    }
  }
  values.push(...ownNonNullValues(project, ["gitDeployments"]));
  return normalizeConsistentAliases(values, (value) => {
    if (value === true || value === "enabled") return "enabled";
    if (value === false || value === "disabled") return "disabled";
    return null;
  }, { fallback: "unknown" });
}

function normalizeProtectionMode(project) {
  const values = [];
  for (const [containerName, key] of [
    ["ssoProtection", "deploymentType"],
    ["protection", "mode"],
  ]) {
    if (Object.hasOwn(project, containerName)
      && project[containerName] !== null
      && project[containerName] !== undefined) {
      if (!isRecord(project[containerName])) fail("INPUT_SHAPE_INVALID");
      values.push(...ownNonNullValues(project[containerName], [key]));
    }
  }
  values.push(...ownNonNullValues(project, ["protectionMode"]));
  return normalizeConsistentAliases(values, (value) => {
    return typeof value === "string" && PROTECTION_MODES.has(value) ? value : null;
  }, { fallback: "unknown" });
}

function observeAutomationBypass(project) {
  if (!Object.hasOwn(project, "protectionBypass")) {
    return {
      fieldObserved: false,
      configured: null,
      count: null,
    };
  }
  const bypass = project.protectionBypass;
  if (bypass === undefined || bypass === null) {
    return {
      fieldObserved: true,
      configured: null,
      count: null,
    };
  }
  if (!isRecord(bypass)) fail("INPUT_SHAPE_INVALID");
  // Only the cardinality crosses the trust boundary. The names and values are
  // deliberately never copied to or serialized in the result.
  const count = Object.getOwnPropertyNames(bypass).length;
  return {
    fieldObserved: true,
    configured: count > 0,
    count,
  };
}

function normalizeTimestamp(value) {
  let date;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    date = new Date(value);
  } else if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch)) return null;
    date = new Date(epoch);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    date = new Date(value);
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeOptionalTimestamp(value) {
  if (value === null || value === undefined) return null;
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) fail("INPUT_SHAPE_INVALID");
  return timestamp;
}

function normalizeRequiredTimestamp(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) fail("INPUT_SHAPE_INVALID");
  return timestamp;
}

function deploymentCreatedAt(deployment) {
  return normalizeConsistentAliases(
    ownNonNullValues(deployment, ["createdAt", "created", "created_at"]),
    normalizeRequiredTimestamp,
    { required: true },
  );
}

function normalizeTarget(value) {
  if (value === null || value === undefined || value === "preview") return "preview";
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    fail("INPUT_SHAPE_INVALID");
  }
  if (value === "production") return "production";
  return "other";
}

function deploymentHasCustomEnvironment(deployment) {
  if (!Object.hasOwn(deployment, "customEnvironment")
    || deployment.customEnvironment === null
    || deployment.customEnvironment === undefined) {
    return false;
  }
  const customEnvironment = deployment.customEnvironment;
  if (!isRecord(customEnvironment)
    || !Object.hasOwn(customEnvironment, "slug")
    || safeIdentifier(customEnvironment.slug, 128) === null) {
    fail("INPUT_SHAPE_INVALID");
  }
  return true;
}

function normalizeState(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    fail("INPUT_SHAPE_INVALID");
  }
  const upper = value.toUpperCase();
  if (!DEPLOYMENT_STATES.has(upper)) fail("INPUT_SHAPE_INVALID");
  return upper;
}

function deploymentState(deployment) {
  return normalizeConsistentAliases(
    ownNonNullValues(deployment, ["state", "readyState", "status"]),
    normalizeState,
    { fallback: "UNKNOWN" },
  );
}

function deploymentSha(deployment) {
  const meta = Object.hasOwn(deployment, "meta") ? deployment.meta : null;
  if (meta !== null && meta !== undefined && !isRecord(meta)) {
    fail("INPUT_SHAPE_INVALID");
  }
  const candidates = [];
  const collectCandidate = (record, key) => {
    if (
      isRecord(record)
      && Object.hasOwn(record, key)
      && record[key] !== null
      && record[key] !== undefined
    ) {
      candidates.push(record[key]);
    }
  };
  collectCandidate(meta, "githubCommitSha");
  collectCandidate(meta, "gitCommitSha");
  collectCandidate(deployment, "sha");
  if (candidates.length === 0) return null;

  const normalized = candidates.map((candidate) => {
    if (typeof candidate !== "string" || !/^[0-9a-f]{40}$/i.test(candidate)) {
      fail("INPUT_SHAPE_INVALID");
    }
    return candidate.toLowerCase();
  });
  if (new Set(normalized).size !== 1) fail("INPUT_SHAPE_INVALID");
  return normalized[0];
}

function summarizeDeployments(source) {
  if (!isRecord(source) || !Object.hasOwn(source, "deployments")) {
    fail("INPUT_SHAPE_INVALID");
  }
  const rows = source.deployments;
  if (!Array.isArray(rows)) fail("INPUT_SHAPE_INVALID");
  if (rows.some((row) => !isRecord(row))) fail("INPUT_SHAPE_INVALID");
  const deployments = rows;

  const byTarget = { production: 0, preview: 0, other: 0 };
  const byState = {
    ready: 0,
    building: 0,
    error: 0,
    canceled: 0,
    queued: 0,
    initializing: 0,
    blocked: 0,
    unknown: 0,
  };
  const shaGroups = new Map();
  let withSha = 0;

  for (const row of deployments) {
    const declaredTarget = normalizeConsistentAliases(
      ownNonNullValues(row, ["target"]),
      normalizeTarget,
      { fallback: "preview" },
    );
    const target = deploymentHasCustomEnvironment(row) ? "other" : declaredTarget;
    const state = deploymentState(row);
    const stateBucket = state === "CANCELLED" ? "canceled" : state.toLowerCase();
    byTarget[target] += 1;
    byState[stateBucket in byState ? stateBucket : "unknown"] += 1;

    const createdAt = deploymentCreatedAt(row);
    const sha = deploymentSha(row);
    if (!sha) continue;
    withSha += 1;
    const group = shaGroups.get(sha) ?? {
      sha,
      deploymentCount: 0,
      byTarget: { production: 0, preview: 0, other: 0 },
      states: new Set(),
      latestCreatedAt: null,
    };
    group.deploymentCount += 1;
    group.byTarget[target] += 1;
    group.states.add(state);
    if (createdAt && (!group.latestCreatedAt || createdAt > group.latestCreatedAt)) {
      group.latestCreatedAt = createdAt;
    }
    shaGroups.set(sha, group);
  }

  const shaMetadata = [...shaGroups.values()]
    .map((group) => ({
      sha: group.sha,
      deploymentCount: group.deploymentCount,
      byTarget: group.byTarget,
      states: [...group.states].sort(),
      latestCreatedAt: group.latestCreatedAt,
    }))
    .sort((left, right) => compareText(left.sha, right.sha));

  return {
    total: deployments.length,
    pagination: observePagination(source, deployments.length),
    withSha,
    withoutSha: deployments.length - withSha,
    byTarget,
    byState,
    shaMetadata,
  };
}

function normalizeEnvName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,256}$/.test(value)
    ? value
    : null;
}

function normalizeEnvTargets(value) {
  if (value === null || value === undefined) return [];
  const supplied = Array.isArray(value) ? value : [value];
  if (supplied.some((target) => {
    return typeof target !== "string" || !TARGET_ORDER.includes(target);
  }) || new Set(supplied).size !== supplied.length) {
    fail("INPUT_SHAPE_INVALID");
  }
  return TARGET_ORDER.filter((target) => supplied.includes(target));
}

function normalizeEnvType(value) {
  return typeof value === "string" && ENV_TYPES.has(value) ? value : null;
}

function observePagination(source, rowCount) {
  if (!Object.hasOwn(source, "pagination")) {
    return {
      fieldObserved: false,
      count: null,
      nextCursorPresent: null,
      previousCursorPresent: null,
      singlePageComplete: false,
    };
  }
  const pagination = source.pagination;
  if (!isRecord(pagination)) fail("INPUT_SHAPE_INVALID");
  if (!["count", "next", "prev"].every((key) => Object.hasOwn(pagination, key))) {
    fail("INPUT_SHAPE_INVALID");
  }
  const validCursor = (value) => {
    return value === null
      || (typeof value === "string" && value.length > 0 && value.length <= 512)
      || (Number.isSafeInteger(value) && value >= 0);
  };
  const next = pagination.next;
  const previous = pagination.prev;
  const count = pagination.count;
  if (!validCursor(next) || !validCursor(previous)
    || !Number.isSafeInteger(count)
    || count < 0
    || count !== rowCount) {
    fail("INPUT_SHAPE_INVALID");
  }
  return {
    fieldObserved: true,
    count,
    nextCursorPresent: next !== null && next !== undefined,
    previousCursorPresent: previous !== null && previous !== undefined,
    singlePageComplete: next === null && previous === null,
  };
}

function observeEnvironmentScope(row) {
  let branchIdentity = null;
  if (Object.hasOwn(row, "gitBranch")
    && row.gitBranch !== null
    && row.gitBranch !== undefined) {
    branchIdentity = safeGitRef(row.gitBranch);
    if (branchIdentity === null) fail("INPUT_SHAPE_INVALID");
  }

  let customEnvironmentIdentities = [];
  if (Object.hasOwn(row, "customEnvironmentIds")
    && row.customEnvironmentIds !== null
    && row.customEnvironmentIds !== undefined) {
    if (!Array.isArray(row.customEnvironmentIds)
      || row.customEnvironmentIds.some((value) => safeIdentifier(value, 256) === null)
      || new Set(row.customEnvironmentIds).size !== row.customEnvironmentIds.length) {
      fail("INPUT_SHAPE_INVALID");
    }
    customEnvironmentIdentities = [...row.customEnvironmentIds].sort();
  }

  let configurationSourceObserved = false;
  if (Object.hasOwn(row, "configurationId")
    && row.configurationId !== null
    && row.configurationId !== undefined) {
    if (safeIdentifier(row.configurationId, 256) === null) fail("INPUT_SHAPE_INVALID");
    configurationSourceObserved = true;
  }

  return {
    branchScoped: branchIdentity !== null,
    branchIdentity,
    customEnvironmentScoped: customEnvironmentIdentities.length > 0,
    customEnvironmentIdentities,
    configurationSourceObserved,
  };
}

function summarizeEnvironment(source, requiredNames) {
  if (!isRecord(source) || !Object.hasOwn(source, "envs")) {
    fail("INPUT_SHAPE_INVALID");
  }
  const rows = source.envs;
  if (!Array.isArray(rows)) fail("INPUT_SHAPE_INVALID");
  if (rows.some((row) => !isRecord(row))) fail("INPUT_SHAPE_INVALID");

  const normalizedVariables = rows
    .map((row) => {
      const name = normalizeConsistentAliases(
        ownNonNullValues(row, ["key", "name"]),
        normalizeEnvName,
        { required: true },
      );
      const type = normalizeConsistentAliases(
        ownNonNullValues(row, ["type"]),
        normalizeEnvType,
        { required: true },
      );
      const targets = normalizeConsistentAliases(
        ownNonNullValues(row, ["target", "targets"]),
        normalizeEnvTargets,
        { fallback: [] },
      );
      const scope = observeEnvironmentScope(row);
      if (scope.branchScoped
        && (targets.length !== 1 || targets[0] !== "preview")) {
        fail("INPUT_SHAPE_INVALID");
      }
      return {
        name,
        targets,
        type,
        updatedAt: normalizeConsistentAliases(
          ownNonNullValues(row, ["updatedAt", "updated_at"]),
          normalizeOptionalTimestamp,
          { fallback: null },
        ),
        scope,
      };
    })
    .sort((left, right) => {
      return compareText(left.name, right.name)
        || compareText(left.targets.join(","), right.targets.join(","))
        || compareText(left.type, right.type)
        || compareText(String(left.updatedAt), String(right.updatedAt))
        || compareText(
          String(left.scope.branchIdentity),
          String(right.scope.branchIdentity),
        )
        || compareText(
          left.scope.customEnvironmentIdentities.join(","),
          right.scope.customEnvironmentIdentities.join(","),
        )
        || Number(left.scope.configurationSourceObserved)
          - Number(right.scope.configurationSourceObserved);
    });

  const unscopedTargetOwners = new Set();
  const branchOwners = new Set();
  const customEnvironmentOwners = new Set();
  for (const variable of normalizedVariables) {
    if (variable.scope.branchScoped) {
      const identity = `${variable.name}\u0000${variable.scope.branchIdentity}`;
      if (branchOwners.has(identity)) fail("INPUT_SHAPE_INVALID");
      branchOwners.add(identity);
    } else {
      for (const target of variable.targets) {
        const identity = `${variable.name}\u0000${target}`;
        if (unscopedTargetOwners.has(identity)) fail("INPUT_SHAPE_INVALID");
        unscopedTargetOwners.add(identity);
      }
    }
    for (const customEnvironmentIdentity of variable.scope.customEnvironmentIdentities) {
      const identity = `${variable.name}\u0000${customEnvironmentIdentity}`;
      if (customEnvironmentOwners.has(identity)) fail("INPUT_SHAPE_INVALID");
      customEnvironmentOwners.add(identity);
    }
  }

  const variables = normalizedVariables.map(({ scope, ...variable }) => ({
    ...variable,
    scope: scope.branchScoped
      || scope.customEnvironmentScoped
      || scope.configurationSourceObserved
      ? {
          branchScoped: scope.branchScoped,
          customEnvironmentScoped: scope.customEnvironmentScoped,
          customEnvironmentCount: scope.customEnvironmentIdentities.length,
          configurationSourceObserved: scope.configurationSourceObserved,
        }
      : null,
  }));

  if (!Array.isArray(requiredNames)) fail("INPUT_SHAPE_INVALID");
  const normalizedRequiredNames = requiredNames.map(normalizeEnvName);
  if (normalizedRequiredNames.some((name) => !name)) fail("INPUT_SHAPE_INVALID");
  const required = [...new Set(normalizedRequiredNames)]
    .sort()
    .map((name) => {
      const matches = normalizedVariables.filter((variable) => variable.name === name);
      return {
        name,
        present: matches.length > 0,
        targets: TARGET_ORDER.filter((target) => {
          return matches.some((variable) => {
            return !variable.scope.branchScoped && variable.targets.includes(target);
          });
        }),
        scopedOnly: matches.length > 0
          && matches.every((variable) => {
            return variable.scope.branchScoped || variable.targets.length === 0;
          }),
      };
    });

  return {
    count: variables.length,
    pagination: observePagination(source, variables.length),
    required,
    variables,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function parseJson(raw) {
  try {
    const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(normalized);
  } catch {
    fail("INPUT_JSON_INVALID");
  }
}

function validateEnvelope(input) {
  if (!isRecord(input)) fail("INPUT_SHAPE_INVALID");
  const keys = Object.keys(input);
  if (keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    fail("INPUT_TOP_LEVEL_REJECTED");
  }
  if (![...ENVELOPE_KEYS].every((key) => Object.hasOwn(input, key))) {
    fail("INPUT_SHAPE_INVALID");
  }
  if (!isRecord(input.project) || !isRecord(input.env) || !isRecord(input.deployments)) {
    fail("INPUT_SHAPE_INVALID");
  }
}

export function createReleaseInventorySummary(input, { requiredEnvNames = [] } = {}) {
  validateEnvelope(input);
  const bypass = observeAutomationBypass(input.project);
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    evaluationMode: "offline-local-artifacts",
    sourceAttestationVerified: false,
    productionProof: false,
    releaseEligible: false,
    project: {
      name: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["name"]),
        safeIdentifier,
        { fallback: null },
      ),
      projectId: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["id", "projectId"]),
        safeProjectId,
        { fallback: null },
      ),
      accountId: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["accountId", "teamId", "orgId"]),
        safeAccountId,
        { fallback: null },
      ),
      rootDirectory: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["rootDirectory"]),
        safeRelativePath,
        { fallback: null },
      ),
      framework: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["framework"]),
        safeFramework,
        { fallback: null },
      ),
      nodeVersion: normalizeConsistentAliases(
        ownNonNullValues(input.project, ["nodeVersion"]),
        safeNodeVersion,
        { fallback: null },
      ),
      productionBranch: (() => {
        if (!Object.hasOwn(input.project, "link")
          || input.project.link === null
          || input.project.link === undefined) return null;
        if (!isRecord(input.project.link)) fail("INPUT_SHAPE_INVALID");
        return normalizeConsistentAliases(
          ownNonNullValues(input.project.link, ["productionBranch"]),
          safeGitRef,
          { fallback: null },
        );
      })(),
      gitDeployments: normalizeGitDeployments(input.project),
    },
    deployments: summarizeDeployments(input.deployments),
    environment: summarizeEnvironment(input.env, requiredEnvNames),
    protection: {
      mode: normalizeProtectionMode(input.project),
      automationBypassFieldObserved: bypass.fieldObserved,
      automationBypassConfigured: bypass.configured,
      automationBypassCount: bypass.count,
    },
  };
  const summaryDigest = createHash("sha256")
    .update(canonicalStringify(summary), "utf8")
    .digest("hex");
  return { ...summary, summaryDigest };
}

function parseArgs(argv) {
  const options = {
    requiredEnvNames: [],
    projectFile: null,
    envFile: null,
    deploymentsFile: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--require-env=")) {
      const name = normalizeEnvName(arg.slice("--require-env=".length));
      if (!name) fail("ARGUMENTS_INVALID");
      options.requiredEnvNames.push(name);
    } else if (arg === "--require-env") {
      const name = normalizeEnvName(argv[index + 1]);
      if (!name) fail("ARGUMENTS_INVALID");
      options.requiredEnvNames.push(name);
      index += 1;
    } else if (arg.startsWith("--project-file=")) {
      options.projectFile = arg.slice("--project-file=".length);
      if (!options.projectFile) fail("ARGUMENTS_INVALID");
    } else if (arg === "--project-file") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
        fail("ARGUMENTS_INVALID");
      }
      options.projectFile = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
      if (!options.envFile) fail("ARGUMENTS_INVALID");
    } else if (arg === "--env-file") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
        fail("ARGUMENTS_INVALID");
      }
      options.envFile = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--deployments-file=")) {
      options.deploymentsFile = arg.slice("--deployments-file=".length);
      if (!options.deploymentsFile) fail("ARGUMENTS_INVALID");
    } else if (arg === "--deployments-file") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
        fail("ARGUMENTS_INVALID");
      }
      options.deploymentsFile = argv[index + 1];
      index += 1;
    } else {
      fail("ARGUMENTS_INVALID");
    }
  }
  return options;
}

async function readBoundedStdin() {
  if (process.stdin.isTTY) fail("ARGUMENTS_INVALID");
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function lstatLocalPathWithoutRedirects(resolvedPath) {
  const root = parse(resolvedPath).root;
  const relativePath = relative(root, resolvedPath);
  if (!root || !relativePath || relativePath === ".."
    || relativePath.startsWith(`..${sep}`)) {
    fail("LOCAL_FIXTURE_READ_FAILED");
  }
  const components = relativePath.split(sep).filter(Boolean);
  let current = root;
  let metadata = null;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    metadata = await lstat(current);
    if (metadata.isSymbolicLink()) fail("LOCAL_FIXTURE_READ_FAILED");
    const finalComponent = index === components.length - 1;
    if ((!finalComponent && !metadata.isDirectory())
      || (finalComponent && !metadata.isFile())) {
      fail("LOCAL_FIXTURE_READ_FAILED");
    }
  }
  if (metadata === null) fail("LOCAL_FIXTURE_READ_FAILED");
  return metadata;
}

async function readLocalFixture(filePath) {
  if (
    typeof filePath !== "string"
    || filePath.length === 0
    || filePath.includes("\0")
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(filePath)
    || filePath.startsWith("\\\\")
    || filePath.startsWith("//")
  ) {
    fail("ARGUMENTS_INVALID");
  }
  let handle;
  try {
    const resolvedPath = resolve(filePath);
    const beforeMetadata = await lstatLocalPathWithoutRedirects(resolvedPath);
    const openFlags = process.platform === "win32"
      ? "r"
      : constants.O_RDONLY | constants.O_NOFOLLOW;
    handle = await open(resolvedPath, openFlags);
    const metadata = await handle.stat();
    const sameMetadata = (left, right) => {
      return left.dev === right.dev
        && left.ino === right.ino
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
    };
    if (!metadata.isFile() || !sameMetadata(beforeMetadata, metadata)) {
      fail("LOCAL_FIXTURE_READ_FAILED");
    }
    if (metadata.size > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE");
    const data = await handle.readFile();
    if (data.length > MAX_INPUT_BYTES) fail("INPUT_TOO_LARGE");
    const finalMetadata = await handle.stat();
    if (!finalMetadata.isFile()
      || !sameMetadata(beforeMetadata, finalMetadata)
      || !sameMetadata(metadata, finalMetadata)
      || data.length !== metadata.size) {
      fail("LOCAL_FIXTURE_READ_FAILED");
    }
    return parseJson(data.toString("utf8"));
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    fail("LOCAL_FIXTURE_READ_FAILED");
  } finally {
    if (handle) await handle.close();
  }
}

async function loadInput(options) {
  const files = [options.projectFile, options.envFile, options.deploymentsFile];
  const fileCount = files.filter(Boolean).length;
  if (fileCount === 0) return parseJson(await readBoundedStdin());
  if (fileCount !== files.length) fail("ARGUMENTS_INVALID");
  return {
    project: await readLocalFixture(options.projectFile),
    env: await readLocalFixture(options.envFile),
    deployments: await readLocalFixture(options.deploymentsFile),
  };
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/vercel-release-inventory.mjs [options]\n\n`);
  process.stdout.write(`Read a {project, env, deployments} JSON envelope from stdin, or use all three local fixture files.\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --project-file=<path>\n`);
  process.stdout.write(`  --env-file=<path>\n`);
  process.stdout.write(`  --deployments-file=<path>\n`);
  process.stdout.write(`  --require-env=<NAME>  Repeat to report required-name presence.\n`);
  process.stdout.write(`  --help\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const input = await loadInput(options);
  const summary = createReleaseInventorySummary(input, {
    requiredEnvNames: options.requiredEnvNames,
  });
  if (summary.deployments.pagination.fieldObserved !== true) {
    fail("INPUT_SHAPE_INVALID");
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  main().catch((error) => {
    const code = error instanceof InventoryError ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`vercel-release-inventory: ${code}\n`);
    process.exitCode = 1;
  });
}
