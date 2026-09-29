-- Synthetic public dependencies only. Real auth/storage schemas come from the
-- disposable Supabase stack; never substitute auth.uid() or Storage metadata.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false,
  couple_id uuid
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid, groom_id uuid);
CREATE TABLE public.vendors(id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users(id), name text);
CREATE TABLE public.account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, email text,
  reason text, deleted_at timestamptz DEFAULT now()
);
CREATE TABLE public.community_upload_sessions (
  id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  staging_path text, final_bucket text, final_path text, expires_at timestamptz
);
