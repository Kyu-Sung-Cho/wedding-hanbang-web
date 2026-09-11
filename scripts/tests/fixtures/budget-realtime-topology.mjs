// 로컬 카탈로그 회귀 전용이다. 운영 원문이나 hosted 복원 환경으로 사용하지 않는다.
export async function createSyntheticBudgetRealtimeTopology(db) {
  await db.exec(`CREATE SCHEMA realtime;
    CREATE TABLE realtime.messages(topic text,extension text,payload jsonb,event text,private boolean,
      updated_at timestamp,inserted_at timestamp,id uuid,binary_payload bytea,skip_broadcast boolean,
      PRIMARY KEY(id,inserted_at)) PARTITION BY RANGE(inserted_at);
    CREATE INDEX messages_inserted_at_topic_index ON realtime.messages(inserted_at DESC,topic)
      WHERE extension='broadcast' AND private IS TRUE;
    CREATE TABLE realtime.messages_2026_09_08 PARTITION OF realtime.messages
      FOR VALUES FROM ('2026-09-08 00:00:00') TO ('2026-09-09 00:00:00');
    CREATE TABLE realtime.messages_2026_09_14 PARTITION OF realtime.messages
      FOR VALUES FROM ('2026-09-14 00:00:00') TO ('2026-09-15 00:00:00');
    CREATE TABLE realtime.other_parent (LIKE realtime.messages INCLUDING ALL) PARTITION BY RANGE(inserted_at);`);
}

export const moveSyntheticRealtimeChild = `ALTER TABLE realtime.messages DETACH PARTITION realtime.messages_2026_09_14;
  ALTER TABLE realtime.other_parent ATTACH PARTITION realtime.messages_2026_09_14
    FOR VALUES FROM ('2026-09-14 00:00:00') TO ('2026-09-15 00:00:00');`;
