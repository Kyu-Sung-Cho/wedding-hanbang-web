// Non-secret, non-routable hosted-project-shaped values for unit tests. Keeping
// the same destination fence in tests prevents production code from gaining a
// hidden NODE_ENV-based bypass.
export const TEST_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
export const TEST_SUPABASE_URL = `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`;
export const TEST_SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"a".repeat(40)}`;

process.env.NEXT_PUBLIC_SUPABASE_URL ??= TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= TEST_SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_EXPECTED_URL ??= TEST_SUPABASE_URL;
process.env.SUPABASE_EXPECTED_PROJECT_REF ??= TEST_SUPABASE_PROJECT_REF;
process.env.SUPABASE_PRODUCTION_PROJECT_REF ??= "slrtobkksjmxgzatjyqb";
