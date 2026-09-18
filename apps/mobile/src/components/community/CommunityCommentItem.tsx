// 글 화면의 답변 한 줄과 그 아래 답글.
//
// 답글은 부모 본문과 같은 줄(아바타 오른쪽)에서 시작하고 왼쪽에 가는 선을 둬 누구에게 단 말인지
// 보이게 한다 — 웹 CommentItem 의 `ml-6 pl-4 border-l` 과 같은 뜻이다. 카드 안에 카드를 넣지 않는다.
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "@/components/ui/AppText";
import { MoreHorizontal } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import { CommunityAvatar } from "@/components/community/CommunityAvatar";
import { CommunityTrustBadges } from "@/components/community/CommunityTrustBadges";
import {
  communityDeletedCommentLabel,
  type CommunityThreadComment,
} from "@/lib/communityCommentThread.mjs";

export type CommunityCommentSafetyTarget = {
  kind: "comment";
  contentId: string;
  userId: string;
  nickname: string;
};

type Props = {
  comment: CommunityThreadComment;
  /** 로그인한 사람의 id(소문자). 없으면 신고 메뉴를 달지 않는다. */
  viewerOwnerId: string | null;
  timeLabel: (createdAt: string) => string;
  onOpenSafetyMenu: (target: CommunityCommentSafetyTarget) => void;
  isReply?: boolean;
};

export function CommunityCommentItem({
  comment,
  viewerOwnerId,
  timeLabel,
  onOpenSafetyMenu,
  isReply = false,
}: Props) {
  const replies = !isReply && comment.replies.length > 0 ? (
    <View style={styles.replies} testID="community-comment-replies">
      {comment.replies.map((reply) => (
        <CommunityCommentItem
          key={reply.id}
          comment={reply}
          viewerOwnerId={viewerOwnerId}
          timeLabel={timeLabel}
          onOpenSafetyMenu={onOpenSafetyMenu}
          isReply
        />
      ))}
    </View>
  ) : null;

  if (comment.is_deleted) {
    return (
      <View style={isReply ? styles.reply : styles.comment}>
        <Text style={styles.deleted}>{communityDeletedCommentLabel(isReply)}</Text>
        {replies}
      </View>
    );
  }

  const name = comment.author?.nickname ?? "익명";
  const canManageAuthor = Boolean(
    viewerOwnerId
    && comment.author_id
    && viewerOwnerId !== comment.author_id.toLowerCase(),
  );

  return (
    <View style={isReply ? styles.reply : styles.comment}>
      <View style={styles.header}>
        <CommunityAvatar nickname={name} role={comment.author?.role} size={isReply ? 24 : 30} />
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{name}</Text>
          <Text style={styles.time}>{timeLabel(comment.created_at)}</Text>
        </View>
        {canManageAuthor ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${name}님 ${isReply ? "답글" : "답변"} 안전 메뉴`}
            style={styles.safetyButton}
            onPress={() => onOpenSafetyMenu({
              kind: "comment",
              contentId: comment.id,
              userId: comment.author_id,
              nickname: name,
            })}
          >
            <MoreHorizontal size={20} color={colors.taupe[400]} />
          </Pressable>
        ) : null}
      </View>
      <CommunityTrustBadges contentOrigin={comment.content_origin} />
      <Text style={isReply ? styles.replyBody : styles.body}>{comment.content}</Text>
      {replies}
    </View>
  );
}

const styles = StyleSheet.create({
  comment: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reply: {
    paddingVertical: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  author: { fontSize: 14, fontWeight: "700", color: colors.noir[800] },
  time: { fontSize: 11, color: colors.taupe[400], marginTop: 1 },
  safetyButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  body: { fontSize: 14, color: colors.noir[800], lineHeight: 22, marginLeft: 40 },
  replyBody: { fontSize: 14, color: colors.noir[800], lineHeight: 22, marginLeft: 34 },
  replies: {
    marginTop: 8,
    marginLeft: 40,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  deleted: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textTertiary,
  },
});
