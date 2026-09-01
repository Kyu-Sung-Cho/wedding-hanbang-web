# chat-image 업로드 울타리 — 운영 적용 (2026-09-02)

> **상태: 운영에 적용됨. 저장소에는 마이그레이션 미반영(드리프트 있음).**
>
> 같은 이유로 미뤄진 건이 둘 더 있다 — `PENDING_ACHIEVEMENTS_RLS_2026-08-28.md`,
> `ADMIN_ACCESS_LOG_2026-09-01.md`. **다음 릴리스에서 셋을 함께 정식화한다.**
> 마이그레이션을 넣으면 successor 릴리스 핀이 어긋나고 매니페스트 sha256 이 바뀌어,
> Vercel `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 을 같이 갱신하지 않으면
> 프로덕션 빌드가 통째로 죽는다.

## 무엇이 열려 있었나

2026-09-02 운영 실측:

```
정책 "Authenticated users can upload chat image"
  cmd=INSERT  roles={authenticated}  조건: bucket_id = 'chat-image' 뿐

버킷 chat-image
  file_size_limit    NULL
  allowed_mime_types NULL
```

경로도 크기도 형식도 보지 않는다. RLS 정책은 OR 로 합쳐지므로, 옆에 있는 좁은
정책(커플 폴더·본인 업로더 폴더)이 있어도 이 하나가 전부 열어 준다.

**즉 로그인만 하면 아무 파일이나 무제한으로 넣을 수 있었다.** 버킷이 비공개라
남이 읽지는 못하지만, 저장 비용과 용량은 그대로 든다.

`'chat-images'`(s 가 붙은 오타 버킷)를 향한 죽은 정책도 하나 있었다. 그런 버킷은
존재하지 않는다.

## 앱은 이 정책을 쓰지 않는다

서버가 service role 로 올린다 — `api/chat/messages/route.ts:683`,
`api/chat/route.ts:1429` 의 `admin.storage.from("chat-image")`. service role 은
RLS 를 우회하므로 이 정책과 무관하다. 브라우저·모바일에서 이 버킷에 직접 올리는
코드는 저장소 전체에서 **0건**이다.

그래서 넓은 정책을 지워도 앱 동작은 바뀌지 않는다. 좁은 정책 둘은 남겼다 —
지금 쓰이지 않아도 나중에 클라이언트 업로드를 열 때의 올바른 모양이다.

## 적용한 SQL

```sql
DROP POLICY IF EXISTS "Authenticated users can upload chat image" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat images" ON storage.objects;

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
 WHERE id = 'chat-image';
```

한도는 앱의 한도와 같은 값이다 — `AMORA_MAX_ATTACHMENT_BYTES` = 10MB,
`CHAT_IMAGE_EXTENSIONS` 네 가지(`lib/chat/attachmentStorage.ts`).

## 확인

```
적용 전:  넓은 정책 2 · INSERT 정책 4 · size_limit NULL · mime NULL
적용 후:  넓은 정책 0 · INSERT 정책 2 · size_limit 10,485,760 · mime 4종
```

기존 객체 6개가 새 한도와 충돌하지 않는 것도 확인했다 — 전부 `image/png`,
최대 85,963 바이트.

## 되돌리기

```sql
CREATE POLICY "Authenticated users can upload chat image" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-image');
UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
 WHERE id = 'chat-image';
```

## 남은 것

- 다른 공개 버킷 중 `file_size_limit` 이 NULL 인 것이 넷 더 있다
  (`cohort-images`, `guestbook-images`, `user_photos`, 그리고 `chat-image` 는
  이제 해결). 각각 업로드 경로를 확인한 뒤 같은 방식으로 한도를 걸어야 한다.
- 이 변경은 **새 업로드**에만 적용된다. 이미 올라온 것은 그대로다.
