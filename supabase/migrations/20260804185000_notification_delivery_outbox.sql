BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- An Expo token proves routing ownership, not consent for this community
-- channel. Reply push therefore has its own durable, default-off preference.
CREATE TABLE public.community_notification_push_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reply_push_enabled boolean NOT NULL DEFAULT false,
  consent_version smallint,
  consented_at timestamptz,
  disabled_at timestamptz DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT community_notification_push_preference_consent_shape CHECK (
    (
      reply_push_enabled = true
      AND consent_version = 1
      AND consented_at IS NOT NULL
      AND disabled_at IS NULL
    )
    OR (
      reply_push_enabled = false
      AND disabled_at IS NOT NULL
      AND (
        (consent_version IS NULL AND consented_at IS NULL)
        OR (consent_version = 1 AND consented_at IS NOT NULL)
      )
    )
  )
);

ALTER TABLE public.community_notification_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_notification_push_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_notification_push_preferences
  FROM PUBLIC, anon, authenticated, service_role;

-- One row is one notification/device binding. No post text, comment text,
-- nickname, vendor, money, date, or other user-authored value is persisted.
CREATE TABLE public.notification_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id uuid,
  binding_epoch bigint,
  state text NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0,
  expo_ticket_id text,
  ticketed_at timestamptz,
  next_receipt_at timestamptz,
  receipt_lease_token uuid,
  receipt_lease_expires_at timestamptz,
  receipt_attempt_count smallint NOT NULL DEFAULT 0,
  receipt_checked_at timestamptz,
  terminal_reason text,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notification_delivery_outbox_target_shape CHECK (
    (installation_id IS NULL AND binding_epoch IS NULL)
    OR (installation_id IS NOT NULL AND binding_epoch IS NOT NULL AND binding_epoch > 0)
  ),
  CONSTRAINT notification_delivery_outbox_state CHECK (
    state IN (
      'pending', 'leased', 'retry_wait', 'ticketed',
      'succeeded', 'cancelled', 'dead_letter'
    )
  ),
  CONSTRAINT notification_delivery_outbox_attempts CHECK (
    attempt_count BETWEEN 0 AND 5
    AND receipt_attempt_count BETWEEN 0 AND 5
  ),
  CONSTRAINT notification_delivery_outbox_lease_shape CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT notification_delivery_outbox_receipt_lease_shape CHECK (
    (receipt_lease_token IS NULL AND receipt_lease_expires_at IS NULL)
    OR (receipt_lease_token IS NOT NULL AND receipt_lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT notification_delivery_outbox_ticket_shape CHECK (
    expo_ticket_id IS NULL
    OR (
      octet_length(expo_ticket_id) BETWEEN 16 AND 128
      AND expo_ticket_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  CONSTRAINT notification_delivery_outbox_terminal_reason CHECK (
    terminal_reason IS NULL OR terminal_reason IN (
      'no_active_device',
      'notification_unavailable',
      'already_read',
      'viewer_hidden',
      'blocked',
      'content_unavailable',
      'preference_disabled',
      'target_inactive',
      'token_revoked',
      'retry_exhausted',
      'permanent_provider_error'
    )
  ),
  CONSTRAINT notification_delivery_outbox_error_code CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'DeviceNotRegistered',
      'MessageTooBig',
      'MessageRateExceeded',
      'MismatchSenderId',
      'InvalidCredentials',
      'ExpoServerError',
      'network_error',
      'invalid_response',
      'lease_expired',
      'receipt_not_ready'
    )
  )
);

CREATE UNIQUE INDEX notification_delivery_outbox_target_uidx
  ON public.notification_delivery_outbox(
    notification_id,
    installation_id,
    binding_epoch
  )
  WHERE installation_id IS NOT NULL;
CREATE UNIQUE INDEX notification_delivery_outbox_no_target_uidx
  ON public.notification_delivery_outbox(notification_id)
  WHERE installation_id IS NULL;
CREATE INDEX notification_delivery_outbox_send_idx
  ON public.notification_delivery_outbox(available_at, created_at, id)
  WHERE state IN ('pending', 'retry_wait') AND terminal_reason IS NULL;
CREATE INDEX notification_delivery_outbox_receipt_idx
  ON public.notification_delivery_outbox(next_receipt_at, ticketed_at, id)
  WHERE state = 'ticketed' AND receipt_checked_at IS NULL;
CREATE INDEX notification_delivery_outbox_recipient_idx
  ON public.notification_delivery_outbox(recipient_id, created_at DESC);

ALTER TABLE public.notification_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_delivery_outbox
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.notification_push_backoff(
  p_attempt_count integer
)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_attempt_count <= 1 THEN interval '1 minute'
    WHEN p_attempt_count = 2 THEN interval '5 minutes'
    WHEN p_attempt_count = 3 THEN interval '15 minutes'
    ELSE interval '1 hour'
  END
$$;

REVOKE ALL ON FUNCTION community_private.notification_push_backoff(integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.notification_push_cancel_reason(
  p_delivery_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery public.notification_delivery_outbox%ROWTYPE;
  v_notification public.community_reply_notifications%ROWTYPE;
BEGIN
  SELECT delivery.* INTO v_delivery
  FROM public.notification_delivery_outbox AS delivery
  WHERE delivery.id = p_delivery_id;
  IF NOT FOUND THEN
    RETURN 'notification_unavailable';
  END IF;

  SELECT notification.* INTO v_notification
  FROM public.community_reply_notifications AS notification
  WHERE notification.id = v_delivery.notification_id
    AND notification.recipient_id = v_delivery.recipient_id;
  IF NOT FOUND THEN
    RETURN 'notification_unavailable';
  END IF;
  IF v_notification.read_at IS NOT NULL THEN
    RETURN 'already_read';
  END IF;
  IF v_notification.viewer_control_hidden_at IS NOT NULL THEN
    RETURN 'viewer_hidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.community_notification_push_preferences AS preference
    WHERE preference.user_id = v_delivery.recipient_id
      AND preference.reply_push_enabled = true
  ) THEN
    RETURN 'preference_disabled';
  END IF;
  IF community_private.users_are_blocked(
    v_notification.recipient_id,
    v_notification.actor_id
  ) THEN
    RETURN 'blocked';
  END IF;
  IF public.community_runtime_mode() = 'disabled' THEN
    RETURN 'content_unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.community_posts AS post
    WHERE post.id = v_notification.post_id
      AND post.visibility IN ('public', 'members')
      AND COALESCE(post.under_review, false) = false
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.community_comments AS comment
    WHERE comment.id = v_notification.comment_id
      AND comment.post_id = v_notification.post_id
      AND COALESCE(comment.is_deleted, false) = false
  ) OR (
    v_notification.parent_comment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.community_comments AS parent_comment
      WHERE parent_comment.id = v_notification.parent_comment_id
        AND parent_comment.post_id = v_notification.post_id
        AND COALESCE(parent_comment.is_deleted, false) = false
    )
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.community_profiles AS actor_profile
    WHERE actor_profile.user_id = v_notification.actor_id
      AND COALESCE(actor_profile.is_suspended, false) = false
  ) THEN
    RETURN 'content_unavailable';
  END IF;

  IF v_delivery.installation_id IS NULL THEN
    RETURN 'no_active_device';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.mobile_push_device_tokens AS device_token
    JOIN auth.sessions AS auth_session
      ON auth_session.id = device_token.session_id
     AND auth_session.user_id = device_token.user_id
    WHERE device_token.installation_id = v_delivery.installation_id
      AND device_token.binding_epoch = v_delivery.binding_epoch
      AND device_token.user_id = v_delivery.recipient_id
      AND device_token.revoked_at IS NULL
      AND device_token.push_token IS NOT NULL
  ) THEN
    RETURN 'target_inactive';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION community_private.notification_push_cancel_reason(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.cancel_notification_delivery(
  p_delivery_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN (
    'no_active_device',
    'notification_unavailable',
    'already_read',
    'viewer_hidden',
    'blocked',
    'content_unavailable',
    'preference_disabled',
    'target_inactive',
    'token_revoked',
    'retry_exhausted',
    'permanent_provider_error'
  ) THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_CANCEL_REASON_INVALID';
  END IF;

  UPDATE public.notification_delivery_outbox AS delivery
  SET terminal_reason = COALESCE(delivery.terminal_reason, p_reason),
      state = CASE
        WHEN delivery.state IN ('ticketed', 'leased', 'succeeded', 'dead_letter')
          THEN delivery.state
        ELSE 'cancelled'
      END,
      completed_at = COALESCE(delivery.completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE delivery.id = p_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION community_private.cancel_notification_delivery(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION community_private.enqueue_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inserted integer;
  v_delivery record;
  v_reason text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'community-reply-push:' || NEW.recipient_id::text,
      0
    )
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.community_notification_push_preferences AS preference
    WHERE preference.user_id = NEW.recipient_id
      AND preference.reply_push_enabled = true
  ) THEN
    INSERT INTO public.notification_delivery_outbox (
      notification_id,
      recipient_id,
      state,
      terminal_reason,
      completed_at
    ) VALUES (
      NEW.id,
      NEW.recipient_id,
      'cancelled',
      'preference_disabled',
      clock_timestamp()
    ) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_delivery_outbox (
    notification_id,
    recipient_id,
    installation_id,
    binding_epoch
  )
  SELECT
    NEW.id,
    NEW.recipient_id,
    device_token.installation_id,
    device_token.binding_epoch
  FROM public.mobile_push_device_tokens AS device_token
  JOIN auth.sessions AS auth_session
    ON auth_session.id = device_token.session_id
   AND auth_session.user_id = device_token.user_id
  WHERE device_token.user_id = NEW.recipient_id
    AND device_token.revoked_at IS NULL
    AND device_token.push_token IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    INSERT INTO public.notification_delivery_outbox (
      notification_id,
      recipient_id,
      state,
      terminal_reason,
      completed_at
    ) VALUES (
      NEW.id,
      NEW.recipient_id,
      'cancelled',
      'no_active_device',
      clock_timestamp()
    ) ON CONFLICT DO NOTHING;
  END IF;

  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.notification_id = NEW.id
  LOOP
    v_reason := community_private.notification_push_cancel_reason(v_delivery.id);
    IF v_reason IS NOT NULL THEN
      PERFORM community_private.cancel_notification_delivery(
        v_delivery.id,
        v_reason
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION community_private.enqueue_notification_delivery()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_get_reply_push_preference()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_enabled boolean;
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT preference.reply_push_enabled
  INTO v_enabled
  FROM public.community_notification_push_preferences AS preference
  WHERE preference.user_id = v_user_id;
  RETURN COALESCE(v_enabled, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_set_reply_push_preference(
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_delivery record;
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'COMMUNITY_REPLY_PUSH_PREFERENCE_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'community-reply-push:' || v_user_id::text,
      0
    )
  );
  INSERT INTO public.community_notification_push_preferences (
    user_id,
    reply_push_enabled,
    consent_version,
    consented_at,
    disabled_at,
    updated_at
  ) VALUES (
    v_user_id,
    p_enabled,
    CASE WHEN p_enabled THEN 1 ELSE NULL END,
    CASE WHEN p_enabled THEN clock_timestamp() ELSE NULL END,
    CASE WHEN p_enabled THEN NULL ELSE clock_timestamp() END,
    clock_timestamp()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET reply_push_enabled = EXCLUDED.reply_push_enabled,
      consent_version = CASE
        WHEN EXCLUDED.reply_push_enabled THEN 1
        ELSE community_notification_push_preferences.consent_version
      END,
      consented_at = CASE
        WHEN EXCLUDED.reply_push_enabled THEN EXCLUDED.consented_at
        ELSE community_notification_push_preferences.consented_at
      END,
      disabled_at = CASE
        WHEN EXCLUDED.reply_push_enabled THEN NULL
        ELSE EXCLUDED.disabled_at
      END,
      updated_at = EXCLUDED.updated_at;

  IF NOT p_enabled THEN
    FOR v_delivery IN
      SELECT delivery.id
      FROM public.notification_delivery_outbox AS delivery
      WHERE delivery.recipient_id = v_user_id
        AND delivery.state NOT IN ('succeeded', 'cancelled', 'dead_letter')
        AND delivery.terminal_reason IS NULL
    LOOP
      PERFORM community_private.cancel_notification_delivery(
        v_delivery.id,
        'preference_disabled'
      );
    END LOOP;
  END IF;
  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.community_get_reply_push_preference()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_set_reply_push_preference(boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_get_reply_push_preference()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_set_reply_push_preference(boolean)
  TO authenticated;

CREATE TRIGGER community_reply_notification_delivery_enqueue
AFTER INSERT ON public.community_reply_notifications
FOR EACH ROW EXECUTE FUNCTION community_private.enqueue_notification_delivery();

-- The original guard predated viewer_control_hidden_at. Keep both fields
-- monotonic while still rejecting every other notification mutation.
CREATE OR REPLACE FUNCTION public.community_guard_reply_notification_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['read_at', 'viewer_control_hidden_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['read_at', 'viewer_control_hidden_at'])
     OR (
       NEW.read_at IS DISTINCT FROM OLD.read_at
       AND (OLD.read_at IS NOT NULL OR NEW.read_at IS NULL)
     )
     OR (
       NEW.viewer_control_hidden_at IS DISTINCT FROM OLD.viewer_control_hidden_at
       AND (
         OLD.viewer_control_hidden_at IS NOT NULL
         OR NEW.viewer_control_hidden_at IS NULL
       )
     )
     OR (
       NEW.read_at IS NOT DISTINCT FROM OLD.read_at
       AND NEW.viewer_control_hidden_at IS NOT DISTINCT FROM OLD.viewer_control_hidden_at
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'COMMUNITY_REPLY_NOTIFICATION_READ_ONLY';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.cancel_notification_delivery_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reason text;
  v_delivery record;
BEGIN
  IF NEW.viewer_control_hidden_at IS NOT NULL
     AND OLD.viewer_control_hidden_at IS NULL THEN
    v_reason := 'viewer_hidden';
  ELSIF NEW.read_at IS NOT NULL AND OLD.read_at IS NULL THEN
    v_reason := 'already_read';
  ELSE
    RETURN NEW;
  END IF;

  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.notification_id = NEW.id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      v_reason
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_reply_notification_delivery_cancel
AFTER UPDATE OF read_at, viewer_control_hidden_at
ON public.community_reply_notifications
FOR EACH ROW
EXECUTE FUNCTION community_private.cancel_notification_delivery_on_update();

CREATE OR REPLACE FUNCTION community_private.cancel_deleted_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
BEGIN
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.notification_id = OLD.id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      'notification_unavailable'
    );
  END LOOP;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION community_private.cancel_deleted_notification_delivery()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_reply_notification_delivery_delete_cancel
AFTER DELETE ON public.community_reply_notifications
FOR EACH ROW
EXECUTE FUNCTION community_private.cancel_deleted_notification_delivery();

CREATE OR REPLACE FUNCTION community_private.cancel_post_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
BEGIN
  IF NEW.visibility IN ('public', 'members')
     AND COALESCE(NEW.under_review, false) = false THEN
    RETURN NEW;
  END IF;
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    JOIN public.community_reply_notifications AS notification
      ON notification.id = delivery.notification_id
    WHERE notification.post_id = NEW.id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      'content_unavailable'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_post_notification_delivery_cancel
AFTER UPDATE OF visibility, under_review ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION community_private.cancel_post_notification_delivery();

CREATE OR REPLACE FUNCTION community_private.cancel_comment_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
BEGIN
  IF COALESCE(NEW.is_deleted, false) = false THEN
    RETURN NEW;
  END IF;
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    JOIN public.community_reply_notifications AS notification
      ON notification.id = delivery.notification_id
    WHERE notification.comment_id = NEW.id
       OR notification.parent_comment_id = NEW.id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      'content_unavailable'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER community_comment_notification_delivery_cancel
AFTER UPDATE OF is_deleted ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION community_private.cancel_comment_notification_delivery();

CREATE OR REPLACE FUNCTION community_private.cancel_device_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
  v_reason text;
BEGIN
  IF OLD.revoked_at IS NOT NULL OR OLD.push_token IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NULL
     AND NEW.push_token IS NOT NULL
     AND NEW.user_id = OLD.user_id
     AND NEW.session_id = OLD.session_id
     AND NEW.binding_epoch = OLD.binding_epoch THEN
    RETURN NEW;
  END IF;
  v_reason := CASE
    WHEN NEW.revoked_at IS NOT NULL OR NEW.push_token IS NULL
      THEN 'token_revoked'
    ELSE 'target_inactive'
  END;
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.installation_id = OLD.installation_id
      AND delivery.binding_epoch = OLD.binding_epoch
      AND delivery.recipient_id = OLD.user_id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      v_reason
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mobile_push_notification_delivery_cancel
AFTER UPDATE OF user_id, session_id, push_token, binding_epoch, revoked_at
ON public.mobile_push_device_tokens
FOR EACH ROW
EXECUTE FUNCTION community_private.cancel_device_notification_delivery();

CREATE OR REPLACE FUNCTION community_private.cancel_deleted_device_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
BEGIN
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.installation_id = OLD.installation_id
      AND delivery.binding_epoch = OLD.binding_epoch
      AND delivery.recipient_id = OLD.user_id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      'target_inactive'
    );
  END LOOP;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION community_private.cancel_deleted_device_notification_delivery()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mobile_push_notification_delivery_delete_cancel
AFTER DELETE ON public.mobile_push_device_tokens
FOR EACH ROW
EXECUTE FUNCTION community_private.cancel_deleted_device_notification_delivery();

CREATE OR REPLACE FUNCTION community_private.cancel_suspended_actor_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery record;
BEGIN
  IF COALESCE(NEW.is_suspended, false) = false THEN
    RETURN NEW;
  END IF;
  FOR v_delivery IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    JOIN public.community_reply_notifications AS notification
      ON notification.id = delivery.notification_id
    WHERE notification.actor_id = NEW.user_id
  LOOP
    PERFORM community_private.cancel_notification_delivery(
      v_delivery.id,
      'content_unavailable'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION community_private.cancel_suspended_actor_notification_delivery()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER community_profile_notification_delivery_cancel
AFTER UPDATE OF is_suspended ON public.community_profiles
FOR EACH ROW
EXECUTE FUNCTION community_private.cancel_suspended_actor_notification_delivery();

CREATE OR REPLACE FUNCTION public.community_claim_notification_push_batch(
  p_lease_token uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  delivery_id uuid,
  notification_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_candidate record;
  v_reason text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_token IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_CLAIM_INVALID';
  END IF;

  WITH stale AS (
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.state = 'leased'
      AND delivery.lease_expires_at <= v_now
    ORDER BY delivery.lease_expires_at, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
  )
  UPDATE public.notification_delivery_outbox AS delivery
  SET state = CASE
        WHEN delivery.terminal_reason IS NOT NULL THEN 'cancelled'
        WHEN delivery.attempt_count >= 5 THEN 'dead_letter'
        ELSE 'retry_wait'
      END,
      terminal_reason = CASE
        WHEN delivery.terminal_reason IS NOT NULL THEN delivery.terminal_reason
        WHEN delivery.attempt_count >= 5 THEN 'retry_exhausted'
        ELSE NULL
      END,
      last_error_code = 'lease_expired',
      available_at = v_now
        + community_private.notification_push_backoff(delivery.attempt_count),
      lease_token = NULL,
      lease_expires_at = NULL,
      completed_at = CASE
        WHEN delivery.terminal_reason IS NOT NULL OR delivery.attempt_count >= 5
          THEN COALESCE(delivery.completed_at, v_now)
        ELSE delivery.completed_at
      END,
      updated_at = v_now
  FROM stale
  WHERE delivery.id = stale.id;

  FOR v_candidate IN
    SELECT delivery.id, delivery.notification_id, delivery.attempt_count
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.state IN ('pending', 'retry_wait')
      AND delivery.terminal_reason IS NULL
      AND delivery.available_at <= v_now
    ORDER BY delivery.available_at, delivery.created_at, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    v_reason := community_private.notification_push_cancel_reason(v_candidate.id);
    IF v_reason IS NOT NULL THEN
      PERFORM community_private.cancel_notification_delivery(
        v_candidate.id,
        v_reason
      );
      CONTINUE;
    END IF;
    IF v_candidate.attempt_count >= 5 THEN
      PERFORM community_private.cancel_notification_delivery(
        v_candidate.id,
        'retry_exhausted'
      );
      UPDATE public.notification_delivery_outbox
      SET state = 'dead_letter', updated_at = v_now
      WHERE id = v_candidate.id;
      CONTINUE;
    END IF;

    UPDATE public.notification_delivery_outbox
    SET state = 'leased',
        lease_token = p_lease_token,
        lease_expires_at = v_now + interval '2 minutes',
        attempt_count = attempt_count + 1,
        updated_at = v_now
    WHERE id = v_candidate.id;

    delivery_id := v_candidate.id;
    notification_id := v_candidate.notification_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_confirm_notification_push_batch(
  p_lease_token uuid,
  p_delivery_ids uuid[]
)
RETURNS TABLE (
  delivery_id uuid,
  notification_id uuid,
  push_token text,
  kind text,
  post_id uuid,
  comment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_candidate record;
  v_reason text;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_token IS NULL
     OR p_delivery_ids IS NULL
     OR cardinality(p_delivery_ids) NOT BETWEEN 1 AND 50
     OR cardinality(p_delivery_ids) <> (
       SELECT count(DISTINCT requested_id)
       FROM unnest(p_delivery_ids) AS requested(requested_id)
     )
     OR EXISTS (
       SELECT 1 FROM unnest(p_delivery_ids) AS requested(requested_id)
       WHERE requested.requested_id IS NULL
     ) THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_CONFIRM_INVALID';
  END IF;

  FOR v_candidate IN
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.id = ANY(p_delivery_ids)
      AND delivery.state = 'leased'
      AND delivery.lease_token = p_lease_token
    ORDER BY delivery.id
    FOR UPDATE
  LOOP
    v_reason := community_private.notification_push_cancel_reason(v_candidate.id);
    IF v_reason IS NOT NULL THEN
      PERFORM community_private.cancel_notification_delivery(
        v_candidate.id,
        v_reason
      );
      UPDATE public.notification_delivery_outbox
      SET state = 'cancelled', lease_token = NULL, lease_expires_at = NULL
      WHERE id = v_candidate.id;
      CONTINUE;
    END IF;

    RETURN QUERY
    SELECT delivery.id,
           delivery.notification_id,
           device_token.push_token,
           notification.kind,
           notification.post_id,
           notification.comment_id
    FROM public.notification_delivery_outbox AS delivery
    JOIN public.community_reply_notifications AS notification
      ON notification.id = delivery.notification_id
    JOIN public.mobile_push_device_tokens AS device_token
      ON device_token.installation_id = delivery.installation_id
     AND device_token.binding_epoch = delivery.binding_epoch
     AND device_token.user_id = delivery.recipient_id
    WHERE delivery.id = v_candidate.id
      AND device_token.revoked_at IS NULL
      AND device_token.push_token IS NOT NULL;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION community_private.revoke_notification_push_target(
  p_delivery_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delivery public.notification_delivery_outbox%ROWTYPE;
BEGIN
  SELECT delivery.* INTO v_delivery
  FROM public.notification_delivery_outbox AS delivery
  WHERE delivery.id = p_delivery_id;
  IF NOT FOUND OR v_delivery.installation_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.mobile_push_device_tokens AS device_token
  SET push_token = NULL,
      revoked_at = COALESCE(device_token.revoked_at, clock_timestamp()),
      revoke_reason = COALESCE(
        device_token.revoke_reason,
        'provider_device_not_registered'
      ),
      last_seen_at = clock_timestamp()
  WHERE device_token.installation_id = v_delivery.installation_id
    AND device_token.binding_epoch = v_delivery.binding_epoch
    AND device_token.user_id = v_delivery.recipient_id
    AND device_token.revoked_at IS NULL
    AND device_token.push_token IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION community_private.revoke_notification_push_target(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_record_notification_push_ticket(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_ticket_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_delivery public.notification_delivery_outbox%ROWTYPE;
  v_reason text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_id IS NULL OR p_lease_token IS NULL
     OR ((p_ticket_id IS NULL) = (p_error_code IS NULL))
     OR (
       p_ticket_id IS NOT NULL
       AND (
         octet_length(p_ticket_id) NOT BETWEEN 16 AND 128
         OR p_ticket_id !~ '^[A-Za-z0-9_-]+$'
       )
     )
     OR (
       p_error_code IS NOT NULL
       AND p_error_code NOT IN (
         'DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded',
         'MismatchSenderId', 'InvalidCredentials', 'ExpoServerError',
         'network_error', 'invalid_response'
       )
     ) THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_TICKET_INVALID';
  END IF;

  SELECT delivery.* INTO v_delivery
  FROM public.notification_delivery_outbox AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.state = 'leased'
    AND delivery.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_reason := community_private.notification_push_cancel_reason(p_delivery_id);
  IF v_reason IS NOT NULL AND v_delivery.terminal_reason IS NULL THEN
    PERFORM community_private.cancel_notification_delivery(
      p_delivery_id,
      v_reason
    );
    v_delivery.terminal_reason := v_reason;
  END IF;

  IF p_ticket_id IS NOT NULL THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'ticketed',
        expo_ticket_id = p_ticket_id,
        ticketed_at = v_now,
        next_receipt_at = v_now + interval '15 minutes',
        receipt_attempt_count = 0,
        receipt_checked_at = NULL,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  IF p_error_code = 'DeviceNotRegistered' THEN
    PERFORM community_private.revoke_notification_push_target(p_delivery_id);
    PERFORM community_private.cancel_notification_delivery(
      p_delivery_id,
      'token_revoked'
    );
    UPDATE public.notification_delivery_outbox
    SET state = 'cancelled',
        last_error_code = p_error_code,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSIF v_delivery.terminal_reason IS NOT NULL OR v_reason IS NOT NULL THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'cancelled',
        last_error_code = p_error_code,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSIF p_error_code IN (
    'MessageRateExceeded', 'ExpoServerError', 'network_error', 'invalid_response'
  ) AND v_delivery.attempt_count < 5 THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'retry_wait',
        available_at = v_now
          + community_private.notification_push_backoff(v_delivery.attempt_count),
        last_error_code = p_error_code,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSE
    UPDATE public.notification_delivery_outbox
    SET state = 'dead_letter',
        terminal_reason = CASE
          WHEN v_delivery.attempt_count >= 5 THEN 'retry_exhausted'
          ELSE 'permanent_provider_error'
        END,
        last_error_code = p_error_code,
        lease_token = NULL,
        lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, v_now),
        updated_at = v_now
    WHERE id = p_delivery_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_claim_notification_push_receipts(
  p_lease_token uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  delivery_id uuid,
  expo_ticket_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_candidate record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_token IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_RECEIPT_CLAIM_INVALID';
  END IF;

  -- A worker may disappear after taking the final receipt lease. Close those
  -- rows once that lease expires so a ticket can never remain stuck forever.
  WITH exhausted AS (
    SELECT delivery.id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.state = 'ticketed'
      AND delivery.receipt_checked_at IS NULL
      AND delivery.receipt_attempt_count >= 5
      AND (
        delivery.receipt_lease_token IS NULL
        OR delivery.receipt_lease_expires_at <= v_now
      )
    ORDER BY delivery.receipt_lease_expires_at NULLS FIRST, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
  )
  UPDATE public.notification_delivery_outbox AS delivery
  SET state = CASE
        WHEN delivery.terminal_reason IS NULL THEN 'dead_letter'
        ELSE 'cancelled'
      END,
      terminal_reason = COALESCE(delivery.terminal_reason, 'retry_exhausted'),
      last_error_code = 'lease_expired',
      receipt_checked_at = v_now,
      receipt_lease_token = NULL,
      receipt_lease_expires_at = NULL,
      completed_at = COALESCE(delivery.completed_at, v_now),
      updated_at = v_now
  FROM exhausted
  WHERE delivery.id = exhausted.id;

  FOR v_candidate IN
    SELECT delivery.id, delivery.expo_ticket_id
    FROM public.notification_delivery_outbox AS delivery
    WHERE delivery.state = 'ticketed'
      AND delivery.expo_ticket_id IS NOT NULL
      AND delivery.receipt_checked_at IS NULL
      AND delivery.next_receipt_at <= v_now
      AND (
        delivery.receipt_lease_token IS NULL
        OR delivery.receipt_lease_expires_at <= v_now
      )
      AND delivery.receipt_attempt_count < 5
    ORDER BY delivery.next_receipt_at, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    UPDATE public.notification_delivery_outbox
    SET receipt_lease_token = p_lease_token,
        receipt_lease_expires_at = v_now + interval '2 minutes',
        receipt_attempt_count = receipt_attempt_count + 1,
        updated_at = v_now
    WHERE id = v_candidate.id;
    delivery_id := v_candidate.id;
    expo_ticket_id := v_candidate.expo_ticket_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_record_notification_push_receipt(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_receipt_status text,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_delivery public.notification_delivery_outbox%ROWTYPE;
  v_reason text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_id IS NULL OR p_lease_token IS NULL
     OR p_receipt_status NOT IN ('ok', 'error', 'not_ready', 'invalid_response')
     OR (p_receipt_status = 'ok' AND p_error_code IS NOT NULL)
     OR (
       p_receipt_status = 'error'
       AND p_error_code NOT IN (
         'DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded',
         'MismatchSenderId', 'InvalidCredentials', 'ExpoServerError'
       )
     )
     OR (
       p_receipt_status IN ('not_ready', 'invalid_response')
       AND p_error_code IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'NOTIFICATION_PUSH_RECEIPT_INVALID';
  END IF;

  SELECT delivery.* INTO v_delivery
  FROM public.notification_delivery_outbox AS delivery
  WHERE delivery.id = p_delivery_id
    AND delivery.state = 'ticketed'
    AND delivery.receipt_lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_reason := community_private.notification_push_cancel_reason(p_delivery_id);
  IF v_reason IS NOT NULL AND v_delivery.terminal_reason IS NULL THEN
    PERFORM community_private.cancel_notification_delivery(
      p_delivery_id,
      v_reason
    );
    v_delivery.terminal_reason := v_reason;
  END IF;

  IF v_delivery.terminal_reason IS NOT NULL
     AND NOT (
       p_receipt_status = 'error'
       AND p_error_code = 'DeviceNotRegistered'
     ) THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'cancelled',
        last_error_code = CASE
          WHEN p_receipt_status = 'not_ready' THEN 'receipt_not_ready'
          WHEN p_receipt_status = 'invalid_response' THEN 'invalid_response'
          WHEN p_receipt_status = 'error' THEN p_error_code
          ELSE NULL
        END,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, v_now),
        updated_at = v_now
    WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  IF p_receipt_status IN ('not_ready', 'invalid_response') THEN
    IF v_delivery.receipt_attempt_count >= 5 THEN
      UPDATE public.notification_delivery_outbox
      SET state = CASE
            WHEN terminal_reason IS NULL THEN 'dead_letter'
            ELSE 'cancelled'
          END,
          terminal_reason = COALESCE(terminal_reason, 'retry_exhausted'),
          last_error_code = CASE
            WHEN p_receipt_status = 'not_ready' THEN 'receipt_not_ready'
            ELSE 'invalid_response'
          END,
          receipt_checked_at = v_now,
          receipt_lease_token = NULL,
          receipt_lease_expires_at = NULL,
          completed_at = COALESCE(completed_at, v_now),
          updated_at = v_now
      WHERE id = p_delivery_id;
    ELSE
      UPDATE public.notification_delivery_outbox
      SET next_receipt_at = v_now
            + community_private.notification_push_backoff(
              v_delivery.receipt_attempt_count
            ),
          last_error_code = CASE
            WHEN p_receipt_status = 'not_ready' THEN 'receipt_not_ready'
            ELSE 'invalid_response'
          END,
          receipt_lease_token = NULL,
          receipt_lease_expires_at = NULL,
          updated_at = v_now
      WHERE id = p_delivery_id;
    END IF;
    RETURN true;
  END IF;

  IF p_receipt_status = 'ok' THEN
    UPDATE public.notification_delivery_outbox
    SET state = CASE
          WHEN terminal_reason IS NULL THEN 'succeeded'
          ELSE 'cancelled'
        END,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, v_now),
        last_error_code = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  IF p_error_code = 'DeviceNotRegistered' THEN
    PERFORM community_private.revoke_notification_push_target(p_delivery_id);
    PERFORM community_private.cancel_notification_delivery(
      p_delivery_id,
      'token_revoked'
    );
    UPDATE public.notification_delivery_outbox
    SET state = 'cancelled',
        last_error_code = p_error_code,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSIF v_delivery.terminal_reason IS NOT NULL OR v_reason IS NOT NULL THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'cancelled',
        last_error_code = p_error_code,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSIF p_error_code IN ('MessageRateExceeded', 'ExpoServerError')
        AND v_delivery.attempt_count < 5 THEN
    UPDATE public.notification_delivery_outbox
    SET state = 'retry_wait',
        expo_ticket_id = NULL,
        ticketed_at = NULL,
        next_receipt_at = NULL,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        available_at = v_now
          + community_private.notification_push_backoff(v_delivery.attempt_count),
        last_error_code = p_error_code,
        updated_at = v_now
    WHERE id = p_delivery_id;
  ELSE
    UPDATE public.notification_delivery_outbox
    SET state = 'dead_letter',
        terminal_reason = 'permanent_provider_error',
        last_error_code = p_error_code,
        receipt_checked_at = v_now,
        receipt_lease_token = NULL,
        receipt_lease_expires_at = NULL,
        completed_at = COALESCE(completed_at, v_now),
        updated_at = v_now
    WHERE id = p_delivery_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_resolve_notification_push_target(
  p_delivery_id uuid,
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT community_private.notification_push_cancel_reason(delivery.id),
         jsonb_build_object(
           'owner_id', notification.recipient_id,
           'delivery_id', delivery.id,
           'notification_id', notification.id,
           'kind', notification.kind,
           'post_id', notification.post_id,
           'comment_id', notification.comment_id
         )
  INTO v_reason, v_result
  FROM public.notification_delivery_outbox AS delivery
  JOIN public.community_reply_notifications AS notification
    ON notification.id = delivery.notification_id
   AND notification.recipient_id = delivery.recipient_id
  WHERE delivery.id = p_delivery_id
    AND delivery.notification_id = p_notification_id
    AND delivery.recipient_id = v_user_id
    -- A device can receive and tap between Expo accepting the send and this
    -- worker persisting its ticket id. Eligibility is still rechecked here.
    AND delivery.state IN ('leased', 'ticketed', 'succeeded')
    AND delivery.terminal_reason IS NULL;

  IF NOT FOUND OR v_reason IS NOT NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION community_private.notification_push_backoff(integer)
  OWNER TO postgres;
ALTER FUNCTION community_private.notification_push_cancel_reason(uuid)
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_notification_delivery(uuid, text)
  OWNER TO postgres;
ALTER FUNCTION community_private.enqueue_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION public.community_get_reply_push_preference()
  OWNER TO postgres;
ALTER FUNCTION public.community_set_reply_push_preference(boolean)
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_notification_delivery_on_update()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_deleted_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_post_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_comment_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_device_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_deleted_device_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.cancel_suspended_actor_notification_delivery()
  OWNER TO postgres;
ALTER FUNCTION community_private.revoke_notification_push_target(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.community_claim_notification_push_batch(uuid, integer)
  OWNER TO postgres;
ALTER FUNCTION public.community_confirm_notification_push_batch(uuid, uuid[])
  OWNER TO postgres;
ALTER FUNCTION public.community_record_notification_push_ticket(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.community_claim_notification_push_receipts(uuid, integer)
  OWNER TO postgres;
ALTER FUNCTION public.community_record_notification_push_receipt(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.community_resolve_notification_push_target(uuid, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.community_claim_notification_push_batch(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_confirm_notification_push_batch(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_record_notification_push_ticket(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_claim_notification_push_receipts(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_record_notification_push_receipt(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_resolve_notification_push_target(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.community_claim_notification_push_batch(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_confirm_notification_push_batch(uuid, uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_record_notification_push_ticket(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_claim_notification_push_receipts(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_record_notification_push_receipt(uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.community_resolve_notification_push_target(uuid, uuid)
  TO authenticated;

COMMENT ON TABLE public.notification_delivery_outbox IS
  'Private content-free remote push delivery ledger, enqueued atomically with in-app reply notifications.';
COMMENT ON TABLE public.community_notification_push_preferences IS
  'Default-off consent gate for external community reply push, separate from in-app notifications and token ownership.';
COMMENT ON FUNCTION public.community_claim_notification_push_batch(uuid, integer) IS
  'Service-only bounded send lease; returns ids only until a final eligibility confirmation.';
COMMENT ON FUNCTION public.community_confirm_notification_push_batch(uuid, uuid[]) IS
  'Service-only final eligibility fence returning generic route ids and an exact active installation token.';
COMMENT ON FUNCTION public.community_resolve_notification_push_target(uuid, uuid) IS
  'Authenticated owner-only tap resolver; returns no user-authored notification content.';

COMMIT;
