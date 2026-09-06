-- 공유 열람·메모 편집은 유지하고, 저장 취소는 저장한 구성원에게 한정한다.
-- 웹을 우회한 authenticated Data API 삭제에도 같은 소유 경계를 적용한다.
DROP POLICY IF EXISTS amora_saved_notes_delete ON public.amora_saved_notes;
CREATE POLICY amora_saved_notes_delete ON public.amora_saved_notes
  FOR DELETE TO authenticated
  USING (saved_by = (SELECT auth.uid()) AND public.is_my_couple(couple_id));
