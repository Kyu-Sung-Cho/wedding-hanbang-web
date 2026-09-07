// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(),
  "../../supabase/migrations/20260905153207_community_hot_rank_before_pagination.sql"), "utf8");

it("ranks all posts before pagination, updates on votes/comments, and retains RLS", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create role feed_reader;
      create table public.community_posts (
        id uuid primary key, created_at timestamptz,
        upvote_count integer, comment_count integer,
        visibility text not null, under_review boolean not null,
        ad_disclosure text not null
      );
      alter table public.community_posts enable row level security;
      grant select on public.community_posts to feed_reader;
      create policy public_feed on public.community_posts for select to feed_reader
        using (visibility = 'public' and under_review = false);
      insert into public.community_posts
        select lpad(i::text, 32, '0')::uuid, '2026-08-01Z', 10, 0, 'public', false, 'general'
        from generate_series(1, 21) i;
      insert into public.community_posts values
        ('00000000-0000-0000-0000-000000000022', '2026-09-01Z', 1, 8, 'public', false, 'general'),
        ('00000000-0000-0000-0000-000000000023', '2026-09-01Z', 999, 0, 'private', false, 'general'),
        ('00000000-0000-0000-0000-000000000024', '2026-09-01Z', 999, 0, 'public', true, 'general'),
        ('00000000-0000-0000-0000-000000000025', null, 0, 0, 'public', false, 'general');
    `);
    await db.exec(migration);
    await db.exec("set role feed_reader");
    const first = await db.query<{ id: string }>(`
      select id from public.community_posts where ad_disclosure = 'general'
      order by hot_rank desc, created_at desc, id desc limit 20
    `);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0].id).toBe("00000000-0000-0000-0000-000000000022");
    const second = await db.query<{ id: string }>(`
      select id from public.community_posts where ad_disclosure = 'general'
      order by hot_rank desc, created_at desc, id desc offset 20 limit 20
    `);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(23);
    expect(second.rows.at(-1)?.id).toBe("00000000-0000-0000-0000-000000000025");
    const originalFormula = await db.query<{ id: string }>(`
      select id from public.community_posts order by
        coalesce(upvote_count, 0) * 2 + coalesce(comment_count, 0) * 3
        - extract(epoch from ('2026-09-06Z'::timestamptz - coalesce(created_at, 'epoch'::timestamptz))) / 7200 desc,
        created_at desc, id desc limit 20
    `);
    expect(first.rows).toEqual(originalFormula.rows);
    await db.exec(`reset role; update public.community_posts
      set comment_count = 10000 where id = '00000000-0000-0000-0000-000000000001';
      set role feed_reader;`);
    const changed = await db.query<{ id: string }>(`
      select id from public.community_posts order by hot_rank desc limit 1
    `);
    expect(changed.rows[0].id).toBe("00000000-0000-0000-0000-000000000001");
    // 단순 한국어 전문 검색은 조사를 분리하지 않는다. 실제 SQL의 부분 검색으로 확인한다.
    const korean = await db.query<{ fts: boolean; partial: boolean }>(`
      select to_tsvector('simple', '스드메는 어디가 좋나요?') @@ plainto_tsquery('simple', '스드메') as fts,
        '스드메는 어디가 좋나요?' ilike '%스드메%' as partial
    `);
    expect(korean.rows).toEqual([{ fts: false, partial: true }]);
    const multiWord = await db.query<{ fts: boolean; partial: boolean }>(`
      select to_tsvector('simple', '스드메 비용 추천') @@ plainto_tsquery('simple', '스드메 추천') as fts,
        ('스드메 비용' ilike '%스드메%' or '추천 후기' ilike '%스드메%') and
        ('스드메 비용' ilike '%추천%' or '추천 후기' ilike '%추천%') as partial
    `);
    expect(multiWord.rows).toEqual([{ fts: true, partial: true }]);
  } finally {
    await db.close();
  }
}, 20_000);
