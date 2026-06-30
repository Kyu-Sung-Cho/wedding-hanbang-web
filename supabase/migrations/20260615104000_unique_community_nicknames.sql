-- Community nicknames must be unique after trimming, lowercasing, and removing whitespace.
-- This mirrors the app-side nickname key used for duplicate prevention.
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_profiles_nickname_key_unique
ON community_profiles (lower(regexp_replace(btrim(nickname), '\s+', '', 'g')));
