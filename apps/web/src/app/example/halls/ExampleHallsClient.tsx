"use client";

import { useMemo, useState } from "react";
import {
  COMPARE_COPY,
  EXAMPLE_COMPARE,
  type CompareModel,
  type CompareSortId,
} from "@hanbang/shared/invitation";

import InvitationCompare from "@/components/invitation/InvitationCompare";

import ExampleColumn from "../ExampleColumn";
import { examplePhotoSrc, exampleRoute } from "../exampleRoutes";

/**
 * 예시 커플 웨딩홀 비교. 하트와 정렬 칩은 이 화면 안에서만 바뀐다.
 * 아티팩트처럼 정렬 칩은 고른 표시만 바뀌고 카드 순서는 그대로다.
 */
export default function ExampleHallsClient() {
  const [picked, setPicked] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(EXAMPLE_COMPARE.halls.map((hall) => [hall.id, hall.picked])),
  );
  const [sort, setSort] = useState<CompareSortId>(COMPARE_COPY.sorts[0].id);

  const model = useMemo<CompareModel>(
    () => ({
      ...EXAMPLE_COMPARE,
      halls: EXAMPLE_COMPARE.halls.map((hall) => ({ ...hall, picked: picked[hall.id] ?? false })),
    }),
    [picked],
  );

  function toggleHall(id: string) {
    setPicked((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <ExampleColumn>
      <InvitationCompare
        model={model}
        sort={sort}
        onSort={setSort}
        onToggleHall={toggleHall}
        resolveRoute={exampleRoute}
        photoSrc={examplePhotoSrc}
      />
    </ExampleColumn>
  );
}
