# image-size의 Next 내장 파서 보완 — 2026-09-13

기존 ICNS/Metro 보완에서 빠져 있던 Next 내장 JXL 파서의 반복 문제를 로컬에서 재현하고 보완했다. 이 기록은 패치·설치본·표적 검증 결과이며, 운영 배포 완료나 모든 이미지 취약점 해결을 뜻하지 않는다.

## 공식 수정판과 기존 보호의 구분

2026-09-13 확인한 공식 권고는 ICNS의 길이 0 항목과 JXL/HEIF의 크기 0 상자로 인한 가용성 문제를 설명한다. 두 권고의 영향 범위는 `image-size <= 2.0.2`, 수정 버전은 `None`이다. [ICNS 권고](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF 권고](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).

`pnpm view image-size version`도 `2.0.2`를 반환했으며, upstream main의 패키지 버전과 같다. 따라서 검증하지 않은 버전 강제 교체나 경고 해제 없이 저장소의 기존 호환 패치를 보완했다. [upstream package.json](https://github.com/image-size/image-size/blob/main/package.json).

Metro가 사용하는 `image-size@1.2.1`에는 이미 ICNS 및 ISO BMFF 상자 보호가 있다. 이번에는 이 파일을 변경하거나 기존 모바일 검사 전체를 반복하지 않았다. 별도 사본인 Next `16.3.4`의 `dist/compiled/image-size/index.js`에는 ICNS만 보완되어 있었다. upstream `findBox`는 다음 검색으로 넘어갈 때만 0 크기를 보정하므로, 찾은 `jxlp`를 반환받는 바깥 반복에서는 같은 항목이 계속 반환될 수 있었다. [upstream 상자 탐색 코드](https://github.com/image-size/image-size/blob/main/lib/types/utils.ts), [upstream JXL 코드](https://github.com/image-size/image-size/blob/main/lib/types/jxl.ts).

## 변경 범위

- `patches/next@16.3.4.patch`: 기존 ICNS 보호를 유지하고 `readBox` 한 함수만 추가 보완했다. 8바이트 헤더가 없는 입력을 거절하고, 크기 0은 남은 전체 길이(EOF)로 해석한다. 양수 크기가 8보다 작거나 남은 바이트보다 크면 거절한다. 반환되는 항목의 크기가 항상 양수이므로 JXL 부분 스트림 반복도 진행된다. EOF 상자의 내부 바이트를 다음 형제 상자로 다시 탐색하지 않는다.
- `pnpm-lock.yaml`: Next 패치 해시만 10곳 갱신했다. 버전·패키지 목록·다른 패치·이미지 형식 활성화 설정은 동일하다.
- `scripts/tests/next-image-parser-security.test.mjs`: 실제 설치된 내장 파서, `getImageSize`, 정적 loader, 운영 모드 optimizer를 제한된 자식 프로세스에서 검증한다. 설치본 전체 바이트와 패치의 일치도 확인한다.

새 패치 SHA-256: `ce96285013dd0e6ed4f25e19cb0ded483b7d3e36e296f56895b0be95f139cb73`.
설치된 파서 SHA-256: `ba7544225ea598d4037147f06e50abd23f8f9a51667de612be0735e17d9865a1`.

## 실행 근거

1. 수정 전 동일한 합성 크기 0 JXL 부분 상자는 `compiled`, `getImageSize`, 정적 loader 세 경로 모두 정상 반환하지 못해 새 검사 3개가 실패했다. 운영 요청이나 고객 파일은 사용하지 않았다.
2. `corepack pnpm install --lockfile-only --ignore-scripts --offline` 후 `corepack pnpm install --frozen-lockfile --offline --ignore-scripts`가 성공했다. 잠금 파일 변경을 기존 해시의 치환과 대조하여 다른 의존성 변경이 없음을 확인했다.
3. 관련 검사 두 파일 합계 **25/25 통과**: 비정상 JXL의 유한 오류 종료, 일반·분할·EOF JXL, 헤더 경계, HEIF/AVIF·JPEG 2000, 기존 ICNS, 정상 PNG/JPEG/WebP/AVIF 및 실제 설치 바이트 일치. 각 자식 프로세스는 V8 heap 64MB와 입력 후 2초 종료 제한을 사용했다.
4. 실제 `imageOptimizer`를 `isDev: false`로 호출한 로컬 검사는 비정상 JXL에서 유한 종료하고, 정상 PNG를 오류 대체 없이 WebP로 변환했다.

검사 명령:

```text
node --test scripts/tests/next-image-parser-security.test.mjs scripts/tests/dependency-security-baseline.test.mjs
```

외부 로컬 증거: `C:/Users/kcho1/.codex/visualizations/launch-final-20260913/next-image-security-result.json`, `next-image-security-red.log`, `next-image-security-green.log`.

## 운영 도달 경로와 한계

검사한 Next 설치본의 정적 이미지 loader는 입력 바이트를 `getImageSize`에 전달하므로 이 변경은 실제 빌드 입력 경계를 보호한다. 서버 optimizer의 `getImageSize(optimizedBuffer)` 호출은 `opts.isDev && width <= BLUR_IMG_SIZE && quality === BLUR_QUALITY` 조건 안에 있다. 운영 이미지 최적화는 Sharp를 사용한다. 기존 제품 코드의 직접 `image-size`/`getImageSize` 호출은 발견하지 못했다.

운영 서비스 공격을 재현한 결과가 아니며, 전체 입력 형식에 대한 퍼징·모든 간접 경로의 안전성을 주장하지 않는다. upstream 정식 수정판 설치나 GitHub 경고 해제도 수행하지 않았다. 실제 운영 배포 상태는 이 패치를 포함한 릴리스의 별도 검증 기록으로 판단한다.
