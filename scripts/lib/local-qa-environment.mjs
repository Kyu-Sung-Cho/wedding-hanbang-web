import { SYNTHETIC_SUPABASE_ENVIRONMENT } from "./synthetic-supabase-environment.mjs";

const LOCAL_DEPLOYMENT_MARKERS = [
  "VERCEL",
  "VERCEL_ENV",
  "HANBANG_DEPLOYMENT_ENV",
  "PRICE_CATALOG_MIN_PUBLISHED_VENDORS",
];

const STATIC_WEB_BUILD_ENV = {
  CI: "true",
  ...SYNTHETIC_SUPABASE_ENVIRONMENT,
  AMORA_OPENAI_ENABLED: "false",
  AMORA_CONVERSATION_SEGMENT_READ_ENABLED: "false",
  AMORA_TODAY_ONE_ENABLED: "false",
  AMORA_MEDIATION_OUTCOME_FOLLOW_UP_ENABLED: "false",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  RESEND_API_KEY: "placeholder",
  NEXT_PUBLIC_SITE_URL: "https://hanbang.ai",
  ADMIN_PASSWORD: "placeholder",
  DECART_API_KEY: "placeholder",
  NEXT_PUBLIC_KAKAO_NATIVE_APP_KEY: "",
  NEXT_PUBLIC_NAVER_CLIENT_ID: "placeholder",
  NAVER_CLIENT_ID: "placeholder",
  NAVER_CLIENT_SECRET: "placeholder",
};

export function createLocalQaWebBuildEnvironment(sourceEnv) {
  const env = { ...sourceEnv };
  for (const key of LOCAL_DEPLOYMENT_MARKERS) delete env[key];
  return { ...env, ...STATIC_WEB_BUILD_ENV };
}
