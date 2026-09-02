import { describe, expect, it } from "vitest";

import { isMissingStorageObject } from "../communityStorageSaga";

/**
 * **부재 확인이 운영이 주는 응답 모양으로 동작하는가.**
 *
 * 2026-09-02 스테이징 실측(storage-js 2.103.0, `chat-image` 버킷):
 *
 *     있을 때  exists → { data: true,  error: null }
 *     없을 때  exists → { data: false, error: { status: 400, message: "Bad Request" } }
 *     있을 때  info   → { data: {...}, error: null }
 *     없을 때  info   → { data: null,  error: { statusCode: "404", message: "Object not found" } }
 *
 * **`exists()` 는 정상적인 "없음"에도 오류를 함께 준다.** 예전 코드는
 * `if (existsError) throw` 였고, 그래서 객체를 지운 직후 부재를 확인할 때마다
 * `storage_absence_check_unavailable` 을 던졌다. 그 코드는 `MANUAL_REVIEW_CODES`
 * 에 없어 재시도로 돌아가므로, **파일이 하나라도 있는 계정은 탈퇴가 절대
 * 끝나지 않고** 크론이 5분마다 영원히 재시도한다.
 *
 * 저장소 테스트가 이걸 못 잡은 이유가 이 파일의 존재 이유다 — mock 이 `exists`
 * 를 `{ data: false, error: null }` 로 흉내냈다. **운영이 만드는 입력과 달랐다.**
 * 그래서 여기서는 위에 적은 **실측 모양 그대로** 넣는다.
 */

// **프로덕션 함수를 그대로 부른다.** 여기 술어를 복사해 두면 프로덕션 판정이
// 망가져도 이 검사는 초록불이다 — 처음 쓸 때 실제로 그렇게 썼고, 판정에서 404 를
// 빼는 사보타주를 못 잡았다(도구가 잡았다).

const REAL_SHAPES = {
  infoAbsent: { statusCode: "404", message: "Object not found" },
  infoBucketMissing: { status: 400, statusCode: "404", message: "Bucket not found" },
  existsAbsent: { status: 400, statusCode: "400", message: "Bad Request" },
  serverError: { status: 500, statusCode: "500", message: "Internal Server Error" },
  unauthorized: { status: 401, statusCode: "401", message: "Unauthorized" },
};

describe("Storage 부재 판정", () => {
  it("info 의 404 는 '정말 없다' 로 읽는다", () => {
    expect(isMissingStorageObject(REAL_SHAPES.infoAbsent)).toBe(true);
  });

  it("exists 의 400 은 '없다' 로 읽지 않는다 — 그게 옛 버그였다", () => {
    // 이 400 은 부재일 때 오는데도 그것만으로는 부재를 뜻하지 않는다.
    // 그래서 `exists()` 를 쓰지 않고 `info()` 로 옮겼다.
    expect(isMissingStorageObject(REAL_SHAPES.existsAbsent)).toBe(false);
  });

  it("모르는 실패는 '없다' 로 읽지 않는다 — 안 지운 파일을 지웠다고 하면 안 된다", () => {
    expect(isMissingStorageObject(REAL_SHAPES.serverError)).toBe(false);
    expect(isMissingStorageObject(REAL_SHAPES.unauthorized)).toBe(false);
    expect(isMissingStorageObject(null)).toBe(false);
    expect(isMissingStorageObject(undefined)).toBe(false);
  });

  it("버킷이 없을 때도 404 로 온다 — 이 경우는 '객체 없음' 과 구분되지 않는다", () => {
    // 알면서 남기는 한계다. 버킷이 사라지는 것은 배포 사고이고, 그때는
    // 인벤토리 단계에서 먼저 걸린다. 여기 적어 두지 않으면 다음 사람이
    // 이 판정을 안전하다고 오해한다.
    expect(isMissingStorageObject(REAL_SHAPES.infoBucketMissing)).toBe(true);
  });

  it("프로덕션 코드가 exists() 를 쓰지 않는다", async () => {
    // 되돌아가면 여기가 잡는다. 소스를 읽는 이유: 이 경로는 실제 Storage 없이
    // 통합 실행이 어렵고, 지키려는 것은 "어느 API 를 쓰는가" 이기 때문이다.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "accountDeletion", "communityStorageSaga.ts"),
      "utf8",
    );
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");
    expect(stripped).not.toContain(".exists(");
    expect(stripped).toContain(".info(row.path)");
    expect(stripped).toContain("isMissingStorageObject(infoError)");
  });
});
