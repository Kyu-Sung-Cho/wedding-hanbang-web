-- READ ONLY / PRE-CHANGE INVENTORY.
-- Safe in the hosted SQL editor. Run this FIRST and save the result as the
-- rollback receipt before touching Dashboard > Storage > Policies.
--
-- 무엇을 확인하나
--   `chat-image` 창고의 SELECT 정책이 **커플을 보지 않고** 열려 있는지.
--   2026-07-15 증거 문서는 다섯 레거시 정책이 "mixed-client window" 를 위해 남아 있다고
--   적었고, 그 뒤 정식 마이그레이션 어디에도 이것을 지우는 문장이 없다. 그러나 저장소
--   기록은 운영의 현재 상태가 아니다 — **이 조회가 정본이다.**
--
-- 결과 읽는 법
--   `verdict` 가 전부 `NO_OPEN_READ` 이면 고칠 것이 없다. 이 경우 apply 파일을 돌리지 마라.
--   `OPEN_READ_PRESENT` 가 하나라도 나오면 apply 파일의 대상이 그것이다.
--
-- 이 스크립트는 표현식과 개수만 남긴다. 객체 이름·사용자 폴더·바이트는 출력하지 않는다.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '60s';

-- 1) 창고가 비공개인지. 비공개여도 아래 정책이 열려 있으면 소용이 없다.
SELECT
  id AS bucket_id,
  public AS is_public,
  CASE
    WHEN public IS FALSE THEN 'PRIVATE_BUCKET_OK'
    ELSE 'STOP_BUCKET_IS_PUBLIC'
  END AS bucket_status
FROM storage.buckets
WHERE id IN ('chat-image', 'chat-images');

-- 2) `chat-image` 를 향한 SELECT 정책 전부. 커플을 보는지 표현식으로 판정한다.
SELECT
  policyname,
  cmd,
  roles,
  qual,
  CASE
    -- 커플 소속을 확인하는 표현식이 들어 있으면 좁은 정책이다.
    WHEN qual ILIKE '%profiles%' AND qual ILIKE '%couple_id%' THEN 'NO_OPEN_READ'
    -- 창고 이름만 비교하는 정책은 로그인 여부·소속과 무관하게 통과시킨다.
    WHEN qual IS NOT NULL AND qual NOT ILIKE '%couple_id%' THEN 'OPEN_READ_PRESENT'
    ELSE 'REVIEW_MANUALLY'
  END AS verdict
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND cmd IN ('SELECT', 'ALL')
  AND (qual ILIKE '%chat-image%' OR policyname ILIKE '%chat%')
ORDER BY policyname;

-- 3) 대상 개수만. 정책을 바꾼 뒤 같은 수가 나오는지 대조하는 데 쓴다.
SELECT
  bucket_id,
  count(*) AS object_count
FROM storage.objects
WHERE bucket_id IN ('chat-image', 'chat-images')
GROUP BY bucket_id
ORDER BY bucket_id;

COMMIT;
