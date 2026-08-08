// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731192000_chat_feedback_account_delete_cascade.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY
    );
    CREATE TABLE public.chat_feedback (
      id uuid PRIMARY KEY,
      user_id uuid,
      couple_id uuid,
      message_id text,
      rating text,
      correction text,
      category text,
      message_content text
    );
  `);
  return db;
}

describe("chat feedback Auth deletion boundary migration", () => {
  it("sanitizes historical ownerless text and cascades live-user feedback", async () => {
    const db = await createFixture();
    const liveUser = "11111111-1111-4111-8111-111111111111";

    await db.exec(`
      INSERT INTO auth.users(id)
      VALUES ('${liveUser}');

      INSERT INTO public.chat_feedback(
        id, user_id, couple_id, message_id, rating, correction, category,
        message_content
      ) VALUES
        (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '${liveUser}',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'live-message',
          'bad',
          'live correction',
          'correction',
          'live shared answer'
        ),
        (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          '22222222-2222-4222-8222-222222222222',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'orphan-message',
          'bad',
          'orphan correction',
          'free text category',
          'orphan answer'
        ),
        (
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          NULL,
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'legacy-message',
          'bad',
          'legacy correction',
          'retry',
          'legacy answer'
        );
    `);

    await db.exec(migration);

    const sanitized = await db.query<{
      id: string;
      user_id: string | null;
      couple_id: string | null;
      message_id: string | null;
      correction: string | null;
      category: string | null;
      message_content: string | null;
    }>(`
      SELECT id, user_id, couple_id, message_id, correction, category,
             message_content
        FROM public.chat_feedback
       WHERE id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       ORDER BY id
    `);

    expect(sanitized.rows).toEqual([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        user_id: null,
        couple_id: null,
        message_id: null,
        correction: null,
        category: null,
        message_content: null,
      },
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        user_id: null,
        couple_id: null,
        message_id: null,
        correction: null,
        category: "retry",
        message_content: null,
      },
    ]);

    await db.exec(`DELETE FROM auth.users WHERE id = '${liveUser}';`);

    const remainingLiveFeedback = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
        FROM public.chat_feedback
       WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    `);
    expect(remainingLiveFeedback.rows[0]?.count).toBe(0);

    await db.close();
  });

  it("pins one validated, non-deferrable ON DELETE CASCADE Auth FK and is rerunnable", async () => {
    const db = await createFixture();

    await db.exec(migration);
    await db.exec(migration);

    const contract = await db.query<{
      constraint_count: number;
      validated: boolean;
      deferrable: boolean;
      initially_deferred: boolean;
      delete_action: string;
      update_action: string;
      match_type: string;
    }>(`
      SELECT count(*)::integer AS constraint_count,
             bool_and(constraint_record.convalidated) AS validated,
             bool_or(constraint_record.condeferrable) AS deferrable,
             bool_or(constraint_record.condeferred) AS initially_deferred,
             min(constraint_record.confdeltype::text) AS delete_action,
             min(constraint_record.confupdtype::text) AS update_action,
             min(constraint_record.confmatchtype::text) AS match_type
        FROM pg_catalog.pg_constraint AS constraint_record
       WHERE constraint_record.conrelid = 'public.chat_feedback'::regclass
         AND constraint_record.conname =
           'chat_feedback_user_id_fkey'
    `);

    expect(contract.rows).toEqual([
      {
        constraint_count: 1,
        validated: true,
        deferrable: false,
        initially_deferred: false,
        delete_action: "c",
        update_action: "a",
        match_type: "s",
      },
    ]);

    await db.close();
  });
});
