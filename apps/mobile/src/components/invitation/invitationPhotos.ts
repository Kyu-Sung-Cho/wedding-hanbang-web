import type { ImageSourcePropType } from "react-native";
import type { ExamplePhotoKey } from "@hanbang/shared/invitation";

/**
 * 청첩장 디자인 사진. 아티팩트 메모: "배경과 웨딩홀 사진은 직접 렌더링한 예시 이미지입니다."
 * 모델은 사진 이름만 들고(`ExamplePhotoKey`), 앱이 그 이름을 번들 이미지로 바꾼다.
 */
const PHOTOS: Record<ExamplePhotoKey, ImageSourcePropType> = {
  "bokeh-blush": require("../../../assets/amora/bokeh-blush.jpg"),
  "hall-sample-garden": require("../../../assets/amora/hall-sample-garden.jpg"),
  "hall-sample-chapel": require("../../../assets/amora/hall-sample-chapel.jpg"),
  "hall-sample-convention": require("../../../assets/amora/hall-sample-convention.jpg"),
};

/** 시작 화면과 홈의 분홍 보케 배경. */
export const INVITATION_BACKDROP = PHOTOS["bokeh-blush"];

/** 모델의 사진 값을 이미지로. 번들 사진 이름이거나 https 주소만 그린다. 모르면 null. */
export function invitationPhotoSource(photo: string | null): ImageSourcePropType | null {
  if (!photo) return null;
  if (Object.hasOwn(PHOTOS, photo)) return PHOTOS[photo as ExamplePhotoKey];
  return /^https:\/\//u.test(photo) ? { uri: photo } : null;
}
