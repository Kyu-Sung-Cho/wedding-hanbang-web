-- DASHBOARD REFERENCE. 이 파일은 마이그레이션이 아니다.
--
-- `storage.objects` 는 호스팅 Supabase 가 `supabase_storage_admin` 으로 소유한다.
-- 이 저장소의 운영 문서가 못 박아 두었다 — "Normal migrations and SQL Editor sessions
-- must not create or drop its policies." 그래서 이 파일은 **Dashboard > Storage >
-- Policies 에서 손으로 할 작업의 참조본**이고, `supabase db push` 로 나가지 않는다.
--
-- ## 왜 바꾸나
--
-- `chat-image` 창고의 조회 정책이 조건을 창고 이름 하나만 두고 `TO public` 으로 열려
-- 있다. 커플이 채팅에 올린 견적서·계약서·사진이 **어느 커플 것인지 보지 않고** 통과한다.
-- 앱 안쪽은 튼튼하다(`api/chat/image-urls` 가 메시지 권한을 먼저 확인한다). 그러나
-- 업로드는 브라우저가 창고에 직접 붙어서 그 층을 지나지 않는다.
--
-- 개인 대화로 표시한 메시지의 첨부도 같은 층에 있다. 창고는 그 약속을 모른다.
--
-- ## 순서 — 이 순서를 지켜라
--
--   1. `..._inventory.sql` 을 먼저 돌리고 결과를 저장한다(롤백 영수증).
--      `verdict` 가 전부 `NO_OPEN_READ` 이면 **여기서 멈춘다.** 고칠 것이 없다.
--   2. 아래 두 문장을 **한 번에** 적용한다. 지우기만 하고 새 정책을 안 넣으면
--      로그인한 커플도 자기 첨부를 못 본다.
--   3. 적용 뒤 채팅에서 사진을 올리고 다시 여는 것까지 실제로 해 본다.
--   4. `..._inventory.sql` 을 다시 돌려 `NO_OPEN_READ` 만 남았는지, 객체 수가 그대로인지
--      확인한다.
--
-- ## 하지 말 것
--
-- 적용 뒤 업로드나 조회가 깨진다고 **넓은 정책을 다시 넣지 마라.** 이 저장소의 운영
-- 문서가 그것을 금지한다 — "never add a broad SELECT merely to make the probe green."
-- 깨지면 원인을 찾아 **커플 범위 안에서** 고쳐라.

-- ── 1) 커플을 보지 않는 조회 정책을 지운다 ──────────────────────────────────
--
-- 이름 둘 다 지운다. `chat-images`(복수) 창고는 이 저장소가 만든 적이 없지만
-- (`20260429000001_storage_buckets.sql` 은 네 개만 만들고 단수만 있다) 같은 롤백
-- 스크립트가 정책은 만들어 두었으므로 함께 치운다.

DROP POLICY IF EXISTS "Anyone can view chat image" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view chat images" ON storage.objects;

-- ── 2) 커플 범위 조회 정책을 넣는다 ────────────────────────────────────────
--
-- 표현식은 이 저장소가 이미 쓰는 것과 **같은 모양**이다
-- (`supabase/migrations/20260615091000_make_chat_images_private.sql` 의
--  `chat-image couple folder write`). 새 방식을 발명하지 않는다.
--
-- 경로는 `{커플}/{보낸사람}/{내용해시}.{확장자}` 이고
-- (`apps/web/src/lib/chat/attachmentStorage.ts:102`), 첫 칸이 커플이다.

DROP POLICY IF EXISTS "chat-image couple folder read" ON storage.objects;
CREATE POLICY "chat-image couple folder read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-image'
    AND (storage.foldername(name))[1] IN (
      SELECT couple_id::text
      FROM public.profiles
      WHERE id = auth.uid()
        AND couple_id IS NOT NULL
    )
  );

-- ── 3) 함께 치우면 좋은 것 (선택) ──────────────────────────────────────────
--
-- `chat-image couple folder update` 는 제품에서 부르는 코드가 0 개다. 유일한 업로드가
-- `upsert: false` 로 올린다(`apps/web/src/stores/chatStore.ts`). 지워도 잃는 기능이
-- 없고, 배우자가 상대 첨부를 덮어쓸 수 있는 자리를 하나 줄인다.
--
-- **`delete` 는 지우지 마라.** 실패한 업로드의 고아 파일을 그 정책으로 치운다.
-- 서버 정리로 옮기기 전에 지우면 조용히 쓰레기가 쌓인다.

-- DROP POLICY IF EXISTS "chat-image couple folder update" ON storage.objects;
