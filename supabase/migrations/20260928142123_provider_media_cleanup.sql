-- Durable removal of abandoned/withdrawn portfolio files through the Storage SDK.
-- Never delete storage.objects directly or reclaim a ready media row.
BEGIN;
ALTER TABLE public.provider_media
  ADD COLUMN cleanup_claim_token uuid,
  ADD COLUMN cleanup_claim_until timestamptz,
  ADD COLUMN cleanup_attempted_at timestamptz,
  ADD COLUMN cleanup_completed_at timestamptz,
  ADD CONSTRAINT provider_media_cleanup_claim_pair CHECK (
    (cleanup_claim_token IS NULL) = (cleanup_claim_until IS NULL)),
  ADD CONSTRAINT provider_media_cleanup_removed CHECK (
    (cleanup_claim_token IS NULL AND cleanup_completed_at IS NULL) OR status='removed');
CREATE INDEX provider_media_cleanup_pending_idx ON public.provider_media
  (coalesce(cleanup_attempted_at,created_at),id)
  WHERE status IN ('uploading','removed') AND cleanup_completed_at IS NULL;

CREATE FUNCTION public.provider_claim_media_cleanup(p_claim_token uuid,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_claim_token IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  -- The grace also covers a removed row whose in-flight upload has not returned.
  -- Row locking serializes this transition with finalize, so a ready file cannot be claimed.
  WITH candidates AS (
    SELECT m.id FROM public.provider_media m
    WHERE m.status IN ('uploading','removed') AND m.cleanup_completed_at IS NULL
      AND m.created_at<=now()-interval '35 minutes'
      AND (m.cleanup_claim_until IS NULL OR m.cleanup_claim_until<=now())
    ORDER BY coalesce(m.cleanup_attempted_at,m.created_at),m.id
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.provider_media m SET status='removed',cleanup_claim_token=p_claim_token,
      cleanup_claim_until=now()+interval '5 minutes',cleanup_attempted_at=now(),updated_at=now()
    FROM candidates c WHERE m.id=c.id RETURNING m.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'provider_id',m.provider_id,'owner_id',p.owner_id,'storage_path',m.storage_path,
    'status',m.status,'created_at',m.created_at,'cleanup_claim_token',m.cleanup_claim_token,
    'cleanup_claim_until',m.cleanup_claim_until)), '[]'::jsonb)
    INTO result FROM claimed m JOIN public.provider_profiles p ON p.id=m.provider_id;
  RETURN result;
END $$;

CREATE FUNCTION public.provider_checkpoint_media_cleanup(p_media_id uuid,p_claim_token uuid,p_storage_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.provider_media SET cleanup_completed_at=now(),cleanup_claim_token=NULL,
    cleanup_claim_until=NULL,updated_at=now()
  WHERE id=p_media_id AND status='removed' AND storage_path=p_storage_path
    AND cleanup_claim_token=p_claim_token AND cleanup_claim_until>now()
    AND created_at<=now()-interval '35 minutes' AND cleanup_completed_at IS NULL;
  RETURN FOUND;
END $$;

ALTER FUNCTION public.provider_claim_media_cleanup(uuid,integer) OWNER TO postgres;
ALTER FUNCTION public.provider_checkpoint_media_cleanup(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provider_claim_media_cleanup(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.provider_checkpoint_media_cleanup(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.provider_claim_media_cleanup(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_checkpoint_media_cleanup(uuid,uuid,text) TO service_role;
COMMIT;
