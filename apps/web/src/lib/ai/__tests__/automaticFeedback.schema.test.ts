// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { saveAutomaticDissatisfaction, type AutomaticFeedbackRecord } from "../automaticFeedback";

const migration = readFileSync(new URL(
  "../../../../../../supabase/migrations/20260913043211_chat_feedback_automatic_signal_nullable.sql",
  import.meta.url
), "utf8");
const actor = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const couple = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
const signals = ["correction", "retry", "frustration", "negative", "confusion", "disengagement"] as const;

// 운영 catalog에서 확인한 필수 컬럼·제약·RLS를 합성 DB에서 재현한다. 고객 행은 사용하지 않는다.
const fixture = `
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.chat_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 couple_id uuid, message_id text NOT NULL, rating text NOT NULL,
 correction text, category text, message_content text, created_at timestamptz DEFAULT now(),
 CONSTRAINT chat_feedback_rating_check CHECK(rating IN ('good','bad')),
 CONSTRAINT chat_feedback_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_feedback_user ON public.chat_feedback(user_id);
CREATE INDEX idx_chat_feedback_couple ON public.chat_feedback(couple_id);
CREATE INDEX idx_chat_feedback_rating ON public.chat_feedback(rating);
CREATE INDEX idx_chat_feedback_created ON public.chat_feedback(created_at DESC);
ALTER TABLE public.chat_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_feedback_service_role_all ON public.chat_feedback FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.chat_feedback TO service_role;
REVOKE ALL ON public.chat_feedback FROM anon,authenticated;
`;

describe("automatic feedback database contract", () => {
  it("fixes the observed NOT NULL rejection without linking conversations or weakening existing access and deletion rules", async () => {
    const db = new PGlite();
    const persist = (record: AutomaticFeedbackRecord) => db.query(
      "INSERT INTO public.chat_feedback(user_id,couple_id,message_id,rating,category,correction,message_content) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [record.user_id, record.couple_id, record.message_id, record.rating, record.category, record.correction, record.message_content]
    ).then(() => undefined);
    try {
      await db.exec(fixture);
      await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [actor, other]);
      await db.query("INSERT INTO public.chat_feedback(user_id,couple_id,message_id,rating) VALUES($1,$2,$3,'good')", [other, couple, message]);
      const manual = (await db.query("SELECT * FROM public.chat_feedback")).rows;
      await db.exec("SET ROLE service_role");
      for (const signal of signals) {
        await expect(saveAutomaticDissatisfaction({ userId: actor, coupleId: couple, signal, visibility: "shared" }, persist))
          .rejects.toMatchObject({ code: "23502", column: "message_id" });
      }
      await db.exec("RESET ROLE");
      expect((await db.query("SELECT * FROM public.chat_feedback")).rows).toEqual(manual);

      await db.exec(migration.replace(/COMMIT;\s*$/, "ROLLBACK;"));
      expect((await db.query<{ attnotnull: boolean }>("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.chat_feedback'::regclass AND attname='message_id'")).rows[0].attnotnull).toBe(true);
      await db.exec(migration);
      // 이미 nullable인 새 환경과 재실행에서도 다른 컬럼을 바꾸지 않는다.
      await db.exec(migration);
      await db.exec("SET ROLE service_role");
      for (const signal of signals) {
        await expect(saveAutomaticDissatisfaction({ userId: actor, coupleId: couple, signal, visibility: "shared" }, persist)).resolves.toBe(true);
      }
      for (const visibility of ["bride_private", "groom_private"] as const) {
        await expect(saveAutomaticDissatisfaction({ userId: actor, coupleId: couple, signal: "correction", visibility }, persist)).resolves.toBe(false);
      }
      const automatic = (await db.query("SELECT message_id,rating,category,correction,message_content FROM public.chat_feedback WHERE user_id=$1 ORDER BY category", [actor])).rows;
      expect(automatic).toEqual([...signals].sort().map(category => ({ message_id: null, rating: "bad", category, correction: null, message_content: null })));
      await expect(db.query("INSERT INTO public.chat_feedback(user_id,message_id,rating) VALUES($1,NULL,'invalid')", [actor])).rejects.toMatchObject({ code: "23514" });
      await expect(db.query("INSERT INTO public.chat_feedback(user_id,message_id,rating) VALUES($1,NULL,'bad')", ["55555555-5555-4555-8555-555555555555"])).rejects.toMatchObject({ code: "23503" });
      await db.exec("RESET ROLE");
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        await expect(db.query("INSERT INTO public.chat_feedback(user_id,message_id,rating) VALUES($1,NULL,'bad')", [actor])).rejects.toMatchObject({ code: "42501" });
        await db.exec("RESET ROLE");
      }

      // NULL 자동 행을 지워서 구형 제약으로 되돌리는 복구는 허용하지 않는다.
      await expect(db.exec("ALTER TABLE public.chat_feedback ALTER COLUMN message_id SET NOT NULL")).rejects.toMatchObject({ code: "23502" });
      expect((await db.query("SELECT * FROM public.chat_feedback WHERE user_id=$1", [other])).rows).toEqual(manual);
      await db.query("DELETE FROM auth.users WHERE id=$1", [actor]);
      expect((await db.query("SELECT * FROM public.chat_feedback")).rows).toEqual(manual);
    } finally {
      await db.close();
    }
  }, 30_000);
});
