import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import type { WeeklyRead } from "../data/weekly.ts";
import { linkHitSlop, radius, space, type } from "../theme/tokens.ts";
import { Light } from "./light.tsx";
import { Text } from "./scaled-text.tsx";
import { RoomWindow, useRoom } from "./today-hero.tsx";
import { RoomCard } from "./warm.tsx";

type Week = NonNullable<WeeklyRead["week"]>;

/**
 * One weekly read, laid out to be acted on (founder, 26 October 2026): what to ask her next first,
 * with why, the morning it grows from, and a button that starts the question; then what she told
 * the family this week; the counts last, small. The read is the week's peak, so it is lit as
 * Today lights her morning.
 */
export function WeeklyReadCard({
  id,
  name,
  week,
  memberId,
  live,
}: {
  id: string;
  name: string;
  week: Week;
  /** Whose read it is: "Ask it" starts a question to her. */
  memberId?: string | undefined;
  /** Only a live read can open its morning; the example has none to open. */
  live: boolean;
}) {
  const { t } = useLingui();
  const room = useRoom();
  const source = week.source;
  const range = week.range;
  const day = source?.dayLabel ?? "";
  const asker = source?.asker ?? null;
  return (
    <RoomCard id={id}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.s,
        }}
      >
        <Text style={[type.label, { letterSpacing: 0, color: room.muted, flexShrink: 1 }]}>
          {range.length === 0 ? t`The weekly read` : t`The weekly read · ${range}`}
        </Text>
        <RoomWindow>
          <Light state="lit" height={26} />
        </RoomWindow>
      </View>

      {week.suggestion === null ? null : (
        <View
          style={{
            gap: space.s,
            padding: space.l,
            borderRadius: radius.panel,
            // Set apart by its glass alone: an outline inside the lit card was one edge too many.
            backgroundColor: room.glass,
          }}
        >
          <Text style={[type.label, { letterSpacing: 0.4, color: room.hot }]}>
            {t`Try this week`}
          </Text>
          <Text style={[type.story, { color: room.ink }]}>{week.suggestion}</Text>
          {source === null ? null : (
            <View style={{ gap: space.xs }}>
              <Text style={[type.caption, { color: room.muted }]}>
                {asker === null
                  ? t`Why: it grows from ${name}'s answer on ${day}.`
                  : t`Why: it grows from ${name}'s answer to ${asker} on ${day}.`}
              </Text>
              {source.summary === null ? null : (
                <Text style={[type.body, { color: room.ink, fontStyle: "italic" }]}>
                  “{source.summary}”
                </Text>
              )}
              {live ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={linkHitSlop}
                  onPress={() =>
                    router.push({ pathname: "/exchange/[id]", params: { id: source.exchangeId } })
                  }
                >
                  <Text
                    style={[type.caption, { color: room.hot, textDecorationLine: "underline" }]}
                  >
                    {t`See that morning`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityHint={t`Opens a question to ${name} with this text, ready to change or send`}
            onPress={() =>
              router.push({
                pathname: "/ask",
                params: {
                  text: week.suggestion ?? "",
                  ...(memberId === undefined ? {} : { recipient: memberId }),
                },
              })
            }
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              marginTop: space.xs,
              paddingVertical: space.s,
              paddingHorizontal: space.l,
              borderRadius: radius.button,
              backgroundColor: room.cream,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={[type.button, { color: room.creamInk }]}>{t`Ask ${name} this`}</Text>
          </Pressable>
        </View>
      )}

      {week.notes.length === 0 ? null : (
        <View style={{ gap: space.m }}>
          <Text style={[type.label, { letterSpacing: 0.4, color: room.muted }]}>
            <Trans>What {name} told the family</Trans>
          </Text>
          {week.notes.map((note) => (
            <Text key={note} style={[type.story, { color: room.ink }]}>
              {note}
            </Text>
          ))}
        </View>
      )}

      {week.counts.length === 0 ? null : (
        <View
          style={{
            gap: space.xs,
            paddingTop: space.m,
            borderTopWidth: 1,
            borderTopColor: room.glassRule,
          }}
        >
          {week.counts.map((line) => (
            <Text key={line} style={[type.caption, { color: room.muted }]}>
              {line}
            </Text>
          ))}
        </View>
      )}
    </RoomCard>
  );
}
