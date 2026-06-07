-- The automation seed is derived from a 32-bit hash. PostgreSQL INT only stores
-- signed 32-bit values, so widen the persisted seed to avoid intermittent
-- "out of range for type integer" failures during dry-runs and cron runs.

ALTER TABLE community_agent_daily_state
  ALTER COLUMN seed TYPE BIGINT;
