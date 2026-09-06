-- 인기 점수의 현재 시각 항은 모든 행에 동일하다. 이를 제외한 값을 저장하면
-- 기존 2*도움돼요 + 3*댓글 - 0.5*경과시간과 같은 순서를 페이지 절단 전에 얻는다.
-- 기존 테이블의 권한/RLS를 그대로 사용한다. API 배포 전에 이 migration이 필요하다.
begin;

alter table public.community_posts add column hot_rank numeric generated always as (
  2::numeric * coalesce(upvote_count, 0)
  + 3::numeric * coalesce(comment_count, 0)
  + coalesce(extract(epoch from (created_at at time zone 'UTC')), 0) / 7200
) stored;

create index community_posts_hot_rank_idx
  on public.community_posts (hot_rank desc, created_at desc, id desc)
  where ad_disclosure = 'general';

comment on column public.community_posts.hot_rank is
  'Time-independent ordering equivalent to 2*upvotes + 3*comments - 0.5*age_hours; computed, never user supplied.';

commit;
