-- 전체 점검(2026-07-27)에서 나온 결함 두 건.
--
-- (1) 저장 기능이 실제로는 동작하지 않았다
--     amora_saved_notes.message_id가 public.messages를 참조하는데, 실제 채팅
--     메시지는 public.chat_messages에 있다(운영 실측: messages 0행 /
--     chat_messages 650행). 채팅에서 "저장"을 누르면 외래키 위반으로 실패한다.
--     최초 E2E가 message_id=null로만 검증해 이 경로를 못 짚었다.
--
-- (2) public.messages가 anon에게 전면 개방돼 있었다
--     ACL이 anon=arwdDxtm(읽기·쓰기·수정·삭제)이고 RLS 정책은 roles={public}에
--     USING/CHECK 모두 true였다. anon 키는 클라이언트 번들에 들어가는 공개 값이라,
--     사실상 누구나 읽고 쓰고 지울 수 있었다. 현재 0행이고 앱 코드에서
--     from("messages") 사용처가 없어 유출은 없지만, 문이 열린 채 남아 있었다.
--     테이블은 지우지 않는다 — 과거 데이터 구조를 남겨 두되 접근만 닫는다.
--
-- 되돌리기:
--   ALTER TABLE public.amora_saved_notes DROP CONSTRAINT amora_saved_notes_message_id_fkey;
--   ALTER TABLE public.amora_saved_notes ADD CONSTRAINT amora_saved_notes_message_id_fkey
--     FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon, authenticated;

-- ── (1) 저장본이 실제 채팅 메시지를 가리키게 ──────────────────
DO $fix_saved_note_message_ref$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'amora_saved_notes'
     AND con.contype = 'f'
     AND con.conkey = ARRAY[(
       SELECT attnum FROM pg_attribute
        WHERE attrelid = rel.oid AND attname = 'message_id'
     )]::smallint[];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.amora_saved_notes DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END;
$fix_saved_note_message_ref$;

-- 원본 메시지가 지워져도 저장본은 남는다(스냅샷을 따로 갖고 있다).
ALTER TABLE public.amora_saved_notes
  ADD CONSTRAINT amora_saved_notes_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;

-- ── (2) 버려진 messages 테이블의 문을 닫는다 ──────────────────
DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_insert ON public.messages;

REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

COMMENT ON TABLE public.messages IS
  '사용하지 않는 과거 테이블. 실제 채팅은 chat_messages를 쓴다. '
  '2026-07-27 anon 전면 개방(arwdDxtm)을 회수하고 공개 정책을 제거했다.';

-- ── 검증 가드 ────────────────────────────────────────────────
DO $verify_message_access_fix$
DECLARE
  refs_chat boolean;
  anon_can_read boolean;
  open_policies integer;
BEGIN
  SELECT ccu.table_name = 'chat_messages' INTO refs_chat
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.table_schema = 'public'
     AND tc.table_name = 'amora_saved_notes'
     AND tc.constraint_name = 'amora_saved_notes_message_id_fkey';

  IF refs_chat IS NOT TRUE THEN
    RAISE EXCEPTION 'SAVED_NOTE_MESSAGE_REF_NOT_FIXED' USING ERRCODE = '23514';
  END IF;

  SELECT has_table_privilege('anon', 'public.messages', 'SELECT') INTO anon_can_read;
  IF anon_can_read THEN
    RAISE EXCEPTION 'LEGACY_MESSAGES_STILL_PUBLIC' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO open_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'messages';
  IF open_policies > 0 THEN
    RAISE EXCEPTION 'LEGACY_MESSAGES_POLICY_REMAINS: %', open_policies USING ERRCODE = '42501';
  END IF;

  RAISE NOTICE '저장본 참조 교정 + 과거 messages 접근 차단 완료';
END;
$verify_message_access_fix$;
