-- Mike M4: the onboarding survey (FR-02). Answers live in profiles.discover_preferences,
-- the column Josh's 0010 adds for Discover scoring (keys: categories, types, dislikedTypes,
-- priceMax, maxDistanceM; validated by _shared/domain/preferences.ts). "if not exists" and
-- the repeated column grant keep this migration correct with or without 0010.
alter table public.profiles
  add column if not exists discover_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(discover_preferences) = 'object'),
  add column preferences_updated_at timestamptz;

comment on column public.profiles.preferences_updated_at is
  'When the survey was last saved (or skipped). null = onboarding not finished yet.';

-- Survey answers are private: the API reads them with the service role (GET /me). Friends and
-- co-participants keep reading display names through the existing RLS policies.
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at, updated_at) on public.profiles to authenticated;
