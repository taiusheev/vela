import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { VoicePlayback } from "../../audio/VoicePlayback.tsx";
import type { ChatMessage, ChatReactionKind } from "../../data/chat.ts";
import { usePalette } from "../../theme/theme.tsx";
import { hitSlop, radius, space, type } from "../../theme/tokens.ts";
import { ExchangePhotos, ReplyPhoto } from "../family-photo.tsx";
import { Light } from "../light.tsx";
import { Words } from "../ui.tsx";

const EMOJI: Record<ChatReactionKind, string> = { heart: "❤️", laugh: "😂", hug: "🤗" };
const ROUND = 20;
const TIGHT = 6;

/** The centred chip between days: "Today", "Yesterday", "Monday 14 Oct". */
export function DayChip({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="header"
      style={{ alignItems: "center", paddingTop: space.l, paddingBottom: space.s }}
    >
      <View
        style={{
          backgroundColor: palette.surface2,
          borderRadius: radius.chip,
          paddingHorizontal: space.m,
          paddingVertical: space.xs,
        }}
      >
        <Text style={[type.caption, { color: palette.ink2 }]}>{label}</Text>
      </View>
    </View>
  );
}

/**
 * One message. Hers on the left in Literata, as her words read everywhere in the app; the reader's
 * on the right in the action teal; the rest of the family on the left with their name; Vela's own
 * hello centred, since nobody in the family sent it. An ask that went into her morning says so.
 */
export function ChatBubble({
  message,
  first,
  last,
  showTime,
  showStatus,
  familyId,
  onReact,
  reacting,
}: {
  message: ChatMessage;
  /** The first of a group from one person: their name shows above it. */
  first: boolean;
  /** The last of a group: the time and the status show under it. */
  last: boolean;
  /** The conversation pauses after this message, so its time shows (`showsTime`). */
  showTime: boolean;
  /** "Seen" or "Delivered" is said here, or the message is still sending or failed (`showsStatus`). */
  showStatus: boolean;
  familyId: string | undefined;
  /** Reactions are given on her messages only. */
  onReact?: (kind: ChatReactionKind) => void;
  reacting?: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const { fontScale } = useWindowDimensions();
  const [picking, setPicking] = useState(false);
  // Tapping her message shows its time with the hearts, as messengers show a time on demand.
  const [timeOpen, setTimeOpen] = useState(false);
  const side = message.side;
  const mine = side === "me";
  const hers = side === "her";
  const from = message.from;
  const time = message.time;

  const text = message.text;
  if (side === "vela") {
    return (
      <View
        accessible
        accessibilityLabel={t`Vela's hello at ${time}: ${text}`}
        style={{
          alignSelf: "center",
          maxWidth: "88%",
          alignItems: "center",
          gap: space.xs,
          paddingVertical: space.m,
        }}
      >
        <Text style={[type.label, { color: palette.ink3, textTransform: "uppercase" }]}>
          {t`Vela · her morning · ${time}`}
        </Text>
        <Text style={[type.body, { color: palette.ink2, textAlign: "center" }]}>
          {message.text}
        </Text>
      </View>
    );
  }

  const background = mine ? palette.action : hers ? palette.surface : palette.surface2;
  const ink = mine ? palette.onAction : palette.ink;
  const words =
    hers && message.tap !== true
      ? { fontFamily: type.story.fontFamily, fontSize: 19, lineHeight: 28 }
      : type.body;
  const corners = mine
    ? {
        borderTopRightRadius: first ? ROUND : TIGHT,
        borderBottomRightRadius: last ? ROUND : TIGHT,
      }
    : {
        borderTopLeftRadius: first ? ROUND : TIGHT,
        borderBottomLeftRadius: last ? ROUND : TIGHT,
      };
  const status =
    message.status === "sending"
      ? t`Sending…`
      : message.status === "failed"
        ? t`Not delivered`
        : message.status === "seen"
          ? t`Seen`
          : message.status === "delivered"
            ? t`Delivered`
            : undefined;
  // "written by Vela" (ADR-49) always shows on its message; the time only at a pause or on a tap.
  const footer = [
    (last && showTime) || timeOpen ? time : undefined,
    last && message.draftedByVela === true ? t`written by Vela` : undefined,
    // A message still sending or not delivered says so wherever it sits in its group.
    (last || message.status === "sending" || message.status === "failed") && showStatus
      ? status
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const spoken = mine ? t`You` : from;
  const label = `${spoken}, ${time}: ${message.text}`;

  const tapOnly = message.tap === true && message.photo === undefined;
  const body = tapOnly ? (
    <Text
      style={[
        message.text.length <= 2 ? { fontSize: 34, lineHeight: 42 } : type.bodyMedium,
        { color: palette.ink },
      ]}
    >
      {message.text}
    </Text>
  ) : (
    <View
      style={{
        backgroundColor: background,
        borderRadius: ROUND,
        ...corners,
        borderWidth: hers ? 1 : 0,
        borderColor: palette.rule,
        paddingHorizontal: space.l,
        paddingVertical: space.m,
        gap: space.s,
      }}
    >
      {message.morning === true ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Light state={mine ? "lit" : "resting"} height={14} />
          <Text
            style={[
              type.label,
              { color: mine ? palette.onAction : palette.ink3, textTransform: "uppercase" },
            ]}
          >
            {t`For her morning`}
          </Text>
        </View>
      ) : null}
      {message.photos === undefined ? null : (
        <ExchangePhotos photos={message.photos} picked={message.picked} size={96} />
      )}
      {message.photo === undefined ? null : <ReplyPhoto photo={message.photo} size="full" />}
      {message.audio === undefined || familyId === undefined ? null : (
        <VoicePlayback
          familyId={familyId}
          mediaId={message.audio.id}
          durationMs={message.audio.duration_ms}
          expiresAt={message.audio.expires_at}
          state={message.audio.state}
          ready={message.audio.state === "ready"}
          label={t`Listen to ${spoken}`}
        />
      )}
      {message.text.length === 0 ? null : (
        <Text selectable style={[words, { color: ink }]}>
          {message.text}
        </Text>
      )}
      {message.original === undefined ? null : (
        <Text style={[type.caption, { color: palette.ink2 }]}>{message.original}</Text>
      )}
    </View>
  );

  return (
    <View
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        alignItems: mine ? "flex-end" : "flex-start",
        maxWidth: fontScale > 1.3 ? "100%" : "84%",
        marginTop: first ? space.m : 2,
        gap: space.xs,
      }}
    >
      {first && side === "family" ? (
        <Text style={[type.caption, { color: palette.ink2, paddingHorizontal: space.s }]}>
          {from}
        </Text>
      ) : null}
      {hers && onReact !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={t`Shows hearts, laughs and hugs to send`}
          onPress={() => {
            const open = !picking;
            setPicking(open);
            setTimeOpen(open);
          }}
          onLongPress={() => {
            setPicking(true);
            setTimeOpen(true);
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label}>
          {body}
        </View>
      )}
      {message.reactions.length === 0 && footer.length === 0 ? null : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: mine ? "flex-end" : "flex-start",
            gap: space.xs,
          }}
        >
          {message.reactions.map((reaction) => {
            const giver = reaction.from;
            return (
              <View
                key={`${reaction.kind}:${reaction.from}`}
                accessible
                accessibilityLabel={
                  reaction.kind === "heart"
                    ? t`${giver} sent a heart`
                    : reaction.kind === "laugh"
                      ? t`${giver} sent a laugh`
                      : t`${giver} sent a hug`
                }
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                  borderRadius: radius.chip,
                  borderWidth: 1,
                  borderColor: reaction.mine ? palette.action : palette.rule,
                  backgroundColor: reaction.mine ? palette.actionSoft : palette.surface,
                  paddingHorizontal: space.s,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: 14 }}>{EMOJI[reaction.kind]}</Text>
                <Text style={[type.caption, { color: palette.ink2 }]}>
                  {reaction.mine ? t`You` : reaction.from}
                </Text>
              </View>
            );
          })}
          {footer.length === 0 ? null : (
            <Text
              style={[
                type.caption,
                {
                  color: message.status === "failed" ? palette.error : palette.ink3,
                  paddingHorizontal: space.s,
                },
              ]}
            >
              {footer}
            </Text>
          )}
        </View>
      )}
      {picking && onReact !== undefined ? (
        <View
          style={{
            flexDirection: "row",
            gap: space.s,
            backgroundColor: palette.surface,
            borderRadius: radius.chip,
            borderWidth: 1,
            borderColor: palette.rule,
            padding: space.xs,
          }}
        >
          {(["heart", "laugh", "hug"] as const).map((kind) => {
            const given = message.reactions.some((item) => item.kind === kind && item.mine);
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected: given, disabled: reacting === true }}
                accessibilityLabel={
                  kind === "heart"
                    ? t`Send ${from} a heart`
                    : kind === "laugh"
                      ? t`Send ${from} a laugh`
                      : t`Send ${from} a hug`
                }
                testID={`chat-react-${kind}`}
                disabled={reacting === true || given}
                hitSlop={hitSlop}
                onPress={() => {
                  onReact(kind);
                  setPicking(false);
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: given ? palette.actionSoft : "transparent",
                  opacity: reacting === true ? 0.5 : 1,
                }}
              >
                <Text style={{ fontSize: 24 }}>{EMOJI[kind]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {message.status === "failed" ? (
        <Words variant="caption" tone="ink2">
          <Trans>Her messenger did not take it. Her daily morning is unchanged.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
