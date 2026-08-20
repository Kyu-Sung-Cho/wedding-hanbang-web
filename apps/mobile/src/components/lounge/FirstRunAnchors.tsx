// 첫 실행 안내가 가리킬 "실제 화면 요소"를 등록하는 자리.
//
// 왜 컨텍스트인가: 코치마크는 라운지 화면이 띄우는데, 가리킬 대상은 그 아래 렌더 트리
// 깊숙한 곳(히어로 카드, 준비 도구 격자)에 있다. props로 ref를 끌어올리면 그 경로의
// 컴포넌트들이 전부 안내를 알아야 하고, 안내를 지울 때 그 배선이 남는다.
//
// 왜 state가 아니라 ref만 쓰는가: 등록은 렌더 결과를 바꾸지 않는다. state로 두면 화면에
// 요소가 하나 붙을 때마다 라운지 전체가 다시 그려진다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

export interface FirstRunAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FirstRunAnchorHandle {
  /** 창 좌표로 잰 위치. 아직 그려지지 않았거나 크기가 0이면 null. */
  measure(): Promise<FirstRunAnchorRect | null>;
  /** 스크롤 컨테이너 안에서의 y. 스크롤 밖(FAB 등)이면 null. */
  getContentOffsetY(): number | null;
}

interface FirstRunAnchorRegistry {
  register(id: string, handle: FirstRunAnchorHandle | null): void;
  getAnchor(id: string): FirstRunAnchorHandle | null;
  registerScroller(scrollToY: ((y: number) => void) | null): void;
  scrollToY(y: number): boolean;
}

// 기본값은 전부 no-op이다. 안내를 띄우지 않는 화면에서 FirstRunAnchor를 그대로 써도
// 아무 일도 일어나지 않아야 한다 — 안내가 없으면 앵커도 없는 게 아니라, 앵커는 늘 있고
// 아무도 안 물어볼 뿐이다.
const NOOP_REGISTRY: FirstRunAnchorRegistry = {
  register: () => {},
  getAnchor: () => null,
  registerScroller: () => {},
  scrollToY: () => false,
};

const FirstRunAnchorContext = createContext<FirstRunAnchorRegistry>(NOOP_REGISTRY);

export function FirstRunAnchorProvider({ children }: { children: ReactNode }) {
  const anchorsRef = useRef(new Map<string, FirstRunAnchorHandle>());
  const scrollerRef = useRef<((y: number) => void) | null>(null);

  const registry = useMemo<FirstRunAnchorRegistry>(
    () => ({
      register(id, handle) {
        if (handle) anchorsRef.current.set(id, handle);
        else anchorsRef.current.delete(id);
      },
      getAnchor(id) {
        return anchorsRef.current.get(id) ?? null;
      },
      registerScroller(scrollToY) {
        scrollerRef.current = scrollToY;
      },
      scrollToY(y) {
        const scrollTo = scrollerRef.current;
        if (!scrollTo) return false;
        try {
          scrollTo(y);
          return true;
        } catch {
          // 스크롤에 실패하면 그 자리에서 재보자. 화면 밖이면 그 단계는 건너뛴다.
          return false;
        }
      },
    }),
    [],
  );

  return (
    <FirstRunAnchorContext.Provider value={registry}>
      {children}
    </FirstRunAnchorContext.Provider>
  );
}

export function useFirstRunAnchorRegistry(): FirstRunAnchorRegistry {
  return useContext(FirstRunAnchorContext);
}

/**
 * 스크롤 컨테이너가 자기를 등록한다. 안내가 화면 아래 요소를 가리켜야 할 때 여기로
 * 스크롤을 부탁한다 — 보이지 않는 곳을 가리키는 말풍선은 안내가 아니다.
 */
export function useFirstRunAnchorScroller(): (
  scrollToY: ((y: number) => void) | null,
) => void {
  const registry = useFirstRunAnchorRegistry();
  return useCallback(
    (scrollToY) => registry.registerScroller(scrollToY),
    [registry],
  );
}

/** measure 콜백이 끝내 오지 않는 경우가 있다(언마운트 직후, 레이아웃 전). 기다림을 끊는다. */
const MEASURE_TIMEOUT_MS = 400;

/**
 * 창 좌표로 잰다. 노드가 없거나, 콜백이 오지 않거나, 크기가 0이면 null.
 *
 * null은 "못 잤다"는 뜻이고, 부르는 쪽은 그때 그 단계를 조용히 건너뛴다.
 */
export function measureNodeInWindow(
  node: View | null,
): Promise<FirstRunAnchorRect | null> {
  return new Promise<FirstRunAnchorRect | null>((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, MEASURE_TIMEOUT_MS);

    node.measureInWindow((x, y, width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

interface FirstRunAnchorProps {
  id: string;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  children: ReactNode;
}

export function FirstRunAnchor({
  id,
  style,
  pointerEvents,
  children,
}: FirstRunAnchorProps) {
  const registry = useFirstRunAnchorRegistry();
  const viewRef = useRef<View>(null);
  const contentOffsetYRef = useRef<number | null>(null);

  useEffect(() => {
    registry.register(id, {
      measure: () => measureNodeInWindow(viewRef.current),
      getContentOffsetY: () => contentOffsetYRef.current,
    });
    return () => registry.register(id, null);
  }, [id, registry]);

  return (
    <View
      ref={viewRef}
      style={style}
      pointerEvents={pointerEvents}
      // Android에서 자식만 있는 View는 네이티브 트리에서 접힐 수 있고, 접힌 View는 잴 수 없다.
      collapsable={false}
      onLayout={(event) => {
        contentOffsetYRef.current = event.nativeEvent.layout.y;
      }}
    >
      {children}
    </View>
  );
}
