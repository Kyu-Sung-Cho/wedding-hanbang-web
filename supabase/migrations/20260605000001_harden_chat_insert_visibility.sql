-- ============================================================
-- Harden chat_messages INSERT privacy
-- ============================================================
-- SELECT privacy already separates shared / bride_private / groom_private.
-- This closes the write side too: authenticated clients may only insert their
-- own sender_id and only the visibility that matches their couple role.
-- service_role still bypasses RLS for server-side AI/system inserts.

DROP POLICY IF EXISTS "chat_insert_couple" ON chat_messages;
CREATE POLICY "chat_insert_couple" ON chat_messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND couple_id IN (
    SELECT id FROM couples
    WHERE bride_id = auth.uid() OR groom_id = auth.uid()
  )
  AND (
    visibility = 'shared'
    OR (
      visibility = 'bride_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = chat_messages.couple_id AND bride_id = auth.uid()
      )
    )
    OR (
      visibility = 'groom_private'
      AND EXISTS (
        SELECT 1 FROM couples
        WHERE id = chat_messages.couple_id AND groom_id = auth.uid()
      )
    )
  )
);
