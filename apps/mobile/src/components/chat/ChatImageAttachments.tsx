import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ImageOff, RefreshCw, X } from "lucide-react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import {
  CHAT_IMAGE_ATTACHMENT_COPY,
  CHAT_IMAGE_THUMBNAIL_GAP,
  chatImageAttachmentLabel,
  chatImageThumbnailSize,
  type ChatImageAttachmentSnapshot,
  type ChatImageAttachmentStore,
  type ChatImageAttachmentTarget,
} from "@/lib/chatImageAttachments.mjs";

type Align = "start" | "end";

/**
 * 채팅 말풍선 위의 첨부 사진 (2026-09-18, wave 2 · 2.5a — 보기 전용).
 *
 * 웹 ChatBubble 과 같이 사람이 보낸 메시지의 사진을 말풍선 위에 그린다. 내 메시지는 오른쪽, 상대 메시지는
 * 왼쪽. 서명 URL 은 채팅 화면이 쥔 저장소(`createChatImageAttachmentStore`)가 받아 오고, 이 컴포넌트는
 * 구독해서 그리기만 한다.
 *
 * - 불러오는 동안: 첨부 수만큼 고정 크기 자리. 뒤집힌 목록이 튀지 않는다.
 * - 404·빈 목록: 아무것도 그리지 않는다(빈 틀 없음).
 * - 실패: "사진을 불러오지 못했어요"와 44pt 이상 재시도.
 * - 썸네일을 누르면 전체 화면 보기(contain). 44pt 닫기와 Android 뒤로가기로 닫힌다. 저장·공유는 없다.
 */
export function ChatImageAttachments({
  store,
  generation,
  ownerId,
  target,
  align,
}: {
  store: ChatImageAttachmentStore;
  generation: number;
  ownerId: string;
  target: ChatImageAttachmentTarget;
  align: Align;
}) {
  const params = { generation, ownerId, messageId: target.messageId, attachmentKey: target.attachmentKey };
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getSnapshot(params));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    void store.load({ generation, ownerId, messageId: target.messageId, attachmentKey: target.attachmentKey });
  }, [store, generation, ownerId, target.messageId, target.attachmentKey]);

  return (
    <ChatImageAttachmentsView
      snapshot={snapshot}
      count={target.count}
      align={align}
      viewerIndex={viewerIndex}
      onOpen={setViewerIndex}
      onClose={() => setViewerIndex(null)}
      onRetry={() => void store.retry(params)}
      onImageError={(url) => store.reportImageError(params, url)}
    />
  );
}

export function ChatImageAttachmentsView({
  snapshot,
  count,
  align,
  viewerIndex,
  onOpen,
  onClose,
  onRetry,
  onImageError,
}: {
  snapshot: ChatImageAttachmentSnapshot;
  count: number;
  align: Align;
  viewerIndex: number | null;
  onOpen: (index: number) => void;
  onClose: () => void;
  onRetry: () => void;
  onImageError: (url: string) => void;
}) {
  if (snapshot.status === "empty") return null;
  const alignment = align === "end" ? styles.alignEnd : styles.alignStart;
  const shown = snapshot.status === "ready" ? snapshot.urls.length : count;
  const size = chatImageThumbnailSize(shown);
  const frame = { width: size, height: size };
  const rowWidth = { maxWidth: shown === 1 ? size : size * 2 + CHAT_IMAGE_THUMBNAIL_GAP };

  const viewer = viewerIndex === null ? null : (
    <ChatImageViewer
      snapshot={snapshot}
      index={viewerIndex}
      onClose={onClose}
      onRetry={onRetry}
      onImageError={onImageError}
    />
  );

  if (snapshot.status === "error") {
    return (
      <View testID="chat-image-attachments" style={[styles.container, alignment]}>
        <View style={styles.errorBox}>
          <View style={styles.errorCopy}>
            <ImageOff size={18} color={colors.textTertiary} />
            <Text style={styles.errorText} accessibilityRole="alert">{CHAT_IMAGE_ATTACHMENT_COPY.loadFailed}</Text>
          </View>
          <RetryButton onRetry={onRetry} />
        </View>
        {viewer}
      </View>
    );
  }

  if (snapshot.status !== "ready") {
    // 보기 창은 묶음 밖에 둔다 — 자리표시 묶음은 스크린리더에 한 덩어리로 읽힌다.
    return (
      <>
        <View
          testID="chat-image-attachments"
          style={[styles.container, styles.row, alignment, rowWidth]}
          accessible
          accessibilityLabel={CHAT_IMAGE_ATTACHMENT_COPY.loadingAccessibilityLabel}
          accessibilityState={{ busy: true }}
        >
          {Array.from({ length: count }, (_, index) => (
            <View key={index} testID="chat-image-placeholder" style={[styles.placeholder, frame]}>
              {index === 0 && <ActivityIndicator size="small" color={colors.rose[500]} />}
            </View>
          ))}
        </View>
        {viewer}
      </>
    );
  }

  return (
    <View testID="chat-image-attachments" style={[styles.container, styles.row, alignment, rowWidth]}>
      {snapshot.urls.map((url, index) => (
        <Pressable
          key={index}
          style={({ pressed }) => [styles.thumbnail, frame, pressed && styles.pressed]}
          onPress={() => onOpen(index)}
          accessibilityRole="imagebutton"
          accessibilityLabel={chatImageAttachmentLabel(index)}
          accessibilityHint={CHAT_IMAGE_ATTACHMENT_COPY.openAccessibilityHint}
        >
          <Image
            source={{ uri: url }}
            style={styles.fill}
            resizeMode="cover"
            onError={() => onImageError(url)}
          />
        </Pressable>
      ))}
      {viewer}
    </View>
  );
}

function RetryButton({ onRetry, onInk = false }: { onRetry: () => void; onInk?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.retry, onInk && styles.retryOnInk, pressed && styles.pressed]}
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={CHAT_IMAGE_ATTACHMENT_COPY.retryAccessibilityLabel}
    >
      <RefreshCw size={15} color={onInk ? colors.paper.onInk : colors.noir[800]} />
      <Text style={[styles.retryText, onInk && styles.retryTextOnInk]}>{CHAT_IMAGE_ATTACHMENT_COPY.retry}</Text>
    </Pressable>
  );
}

/** 전체 화면 보기. 저장·다운로드·공유 컨트롤은 두지 않는다. */
function ChatImageViewer({
  snapshot,
  index,
  onClose,
  onRetry,
  onImageError,
}: {
  snapshot: ChatImageAttachmentSnapshot;
  index: number;
  onClose: () => void;
  onRetry: () => void;
  onImageError: (url: string) => void;
}) {
  const url = snapshot.status === "ready" ? snapshot.urls[index] ?? null : null;
  const label = chatImageAttachmentLabel(index);
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <SafeAreaView style={styles.viewer} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.viewerHeader}>
          <Pressable
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={CHAT_IMAGE_ATTACHMENT_COPY.closeAccessibilityLabel}
          >
            <X size={24} color={colors.paper.onInk} />
          </Pressable>
        </View>
        <View style={styles.viewerBody}>
          {url !== null ? (
            <ViewerImage key={url} url={url} label={label} onImageError={onImageError} />
          ) : snapshot.status === "error" ? (
            <View style={styles.viewerError}>
              <Text style={styles.viewerErrorText} accessibilityRole="alert">{CHAT_IMAGE_ATTACHMENT_COPY.loadFailed}</Text>
              <RetryButton onRetry={onRetry} onInk />
            </View>
          ) : (
            <ActivityIndicator
              size="large"
              color={colors.paper.onInk}
              accessibilityLabel={CHAT_IMAGE_ATTACHMENT_COPY.loadingAccessibilityLabel}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ViewerImage({ url, label, onImageError }: { url: string; label: string; onImageError: (url: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={styles.viewerFrame}>
      {!loaded && (
        <View style={styles.viewerSpinner} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.paper.onInk} />
        </View>
      )}
      <Image
        source={{ uri: url }}
        style={styles.fill}
        resizeMode="contain"
        accessible
        accessibilityLabel={label}
        onLoad={() => setLoaded(true)}
        onError={() => onImageError(url)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: CHAT_IMAGE_THUMBNAIL_GAP },
  alignStart: { alignSelf: "flex-start", justifyContent: "flex-start" },
  alignEnd: { alignSelf: "flex-end", justifyContent: "flex-end" },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.paper.edge,
    backgroundColor: colors.ivory[100],
  },
  thumbnail: {
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.paper.edge,
    backgroundColor: colors.ivory[100],
  },
  fill: { width: "100%", height: "100%" },
  pressed: { opacity: 0.8 },
  errorBox: {
    gap: 8,
    maxWidth: 240,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.paper.edge,
    backgroundColor: colors.ivory[50],
  },
  errorCopy: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flexShrink: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  retry: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.paper.outline,
    backgroundColor: colors.surface,
  },
  retryOnInk: { alignSelf: "center", borderColor: colors.paper.onInkFaint, backgroundColor: colors.paper.inkPressed },
  retryText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  retryTextOnInk: { color: colors.paper.onInk },
  viewer: { flex: 1, backgroundColor: colors.paper.inkPressed },
  viewerHeader: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 8, paddingVertical: 4 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  viewerBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingBottom: 16 },
  viewerFrame: { flex: 1, alignSelf: "stretch" },
  viewerSpinner: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  viewerError: { alignItems: "center", gap: 12 },
  viewerErrorText: { fontSize: 15, lineHeight: 22, color: colors.paper.onInk, textAlign: "center" },
});
