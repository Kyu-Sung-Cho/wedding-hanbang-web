interface PreviewStubDeploymentEnv {
  readonly [key: string]: string | undefined;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  NEXT_PUBLIC_PREVIEW_STUB_MODE?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_EXPECTED_URL?: string;
  SUPABASE_EXPECTED_PROJECT_REF?: string;
  SUPABASE_PRODUCTION_PROJECT_REF?: string;
  SUPABASE_PRODUCTION_WRITE_CONFIRM?: string;
  TARGETED_PREVIEW_BRANCH?: string;
  TARGETED_PREVIEW_CONFIRM?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_ADMIN_KEY?: string;
  OPENAI_CUSTOM_HEADERS?: string;
  OPENAI_ORG_ID?: string;
  OPENAI_PROJECT_ID?: string;
  OPENAI_EXPECTED_PROJECT_ID?: string;
  OPENAI_PRODUCTION_PROJECT_ID?: string;
  AMORA_OPENAI_ENABLED?: string;
  TARGETED_PREVIEW_OPENAI_CONFIRM?: string;
}

const PROJECT_REF = /^[a-z0-9]{20}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const VERCEL_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]{0,251}[a-z0-9])?\.vercel\.app$/u;
const REPOSITORY_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
const OPENAI_PROJECT_ID = /^proj_[A-Za-z0-9_-]{8,128}$/u;
const CANONICAL_OPENAI_BASE_URL = "https://api.openai.com/v1";
const FORBIDDEN_TARGETED_PREVIEW_PROVIDER_SECRETS = [
  "RESEND_API_KEY",
  "DECART_API_KEY",
  "NAVER_CLIENT_SECRET",
  "NAVER_API_HUB_CLIENT_SECRET",
  "SENTRY_AUTH_TOKEN",
] as const;

function hasForbiddenProviderSecret(env: PreviewStubDeploymentEnv): boolean {
  return FORBIDDEN_TARGETED_PREVIEW_PROVIDER_SECRETS.some((name) =>
    Boolean(env[name]),
  );
}

function hasUnsafeOpenAIAmbientOverrides(env: PreviewStubDeploymentEnv): boolean {
  return Boolean(
    (env.OPENAI_BASE_URL?.trim()
      && env.OPENAI_BASE_URL.trim() !== CANONICAL_OPENAI_BASE_URL)
    || env.OPENAI_ADMIN_KEY?.trim()
    || env.OPENAI_CUSTOM_HEADERS?.trim()
    || env.OPENAI_ORG_ID?.trim(),
  );
}

function hasSafeTargetedOpenAIConfiguration(
  env: PreviewStubDeploymentEnv,
  commitSha: string | undefined,
): boolean {
  const hasOpenAICredential = Boolean(env.OPENAI_API_KEY);
  const openAIEnabled = env.AMORA_OPENAI_ENABLED === "true";
  if (hasUnsafeOpenAIAmbientOverrides(env)) return false;
  if (!hasOpenAICredential && !openAIEnabled) {
    return !env.TARGETED_PREVIEW_OPENAI_CONFIRM;
  }

  const actualProject = env.OPENAI_PROJECT_ID;
  const expectedProject = env.OPENAI_EXPECTED_PROJECT_ID;
  const productionProject = env.OPENAI_PRODUCTION_PROJECT_ID;
  return hasOpenAICredential
    && openAIEnabled
    && Boolean(commitSha)
    && Boolean(actualProject)
    && OPENAI_PROJECT_ID.test(actualProject ?? "")
    && expectedProject === actualProject
    && Boolean(productionProject)
    && OPENAI_PROJECT_ID.test(productionProject ?? "")
    && productionProject !== actualProject
    && env.TARGETED_PREVIEW_OPENAI_CONFIRM
      === `TARGETED_OPENAI_NONPROD:${actualProject}:${commitSha}`;
}

function assertTargetedNonProductionPreview(env: PreviewStubDeploymentEnv): void {
  const expectedRef = env.SUPABASE_EXPECTED_PROJECT_REF;
  const expectedUrl = expectedRef ? `https://${expectedRef}.supabase.co` : "";
  const commitSha = env.VERCEL_GIT_COMMIT_SHA;
  const branch = env.VERCEL_GIT_COMMIT_REF;

  if (
    !expectedRef
    || !PROJECT_REF.test(expectedRef)
    || expectedRef === REPOSITORY_PRODUCTION_PROJECT_REF
    || env.SUPABASE_PRODUCTION_PROJECT_REF !== REPOSITORY_PRODUCTION_PROJECT_REF
    || env.NEXT_PUBLIC_SUPABASE_URL !== expectedUrl
    || env.SUPABASE_EXPECTED_URL !== expectedUrl
    || !commitSha
    || !COMMIT_SHA.test(commitSha)
    || !branch
    || branch === "main"
    || env.TARGETED_PREVIEW_BRANCH !== branch
    || !env.VERCEL_URL
    || !VERCEL_PREVIEW_HOST.test(env.VERCEL_URL)
    || env.SUPABASE_PRODUCTION_WRITE_CONFIRM
    || env.TARGETED_PREVIEW_CONFIRM !== `TARGETED_PREVIEW:${expectedRef}:${commitSha}`
    || hasForbiddenProviderSecret(env)
    || !hasSafeTargetedOpenAIConfiguration(env, commitSha)
  ) {
    throw new Error(
      "Non-stub Preview requires a commit-bound, non-production targeted preview configuration",
    );
  }
}

export function assertPreviewStubDeployment(
  env: PreviewStubDeploymentEnv = process.env
): void {
  if (
    env.VERCEL_ENV === "production" &&
    env.NEXT_PUBLIC_PREVIEW_STUB_MODE === "true"
  ) {
    throw new Error(
      "NEXT_PUBLIC_PREVIEW_STUB_MODE must never be enabled in Production"
    );
  }

  if (
    env.VERCEL_ENV === "preview"
    && env.NEXT_PUBLIC_PREVIEW_STUB_MODE !== "true"
  ) {
    assertTargetedNonProductionPreview(env);
  }
}
