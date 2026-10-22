import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { localDateIn } from "../data/chat.ts";
import { localDayMonth } from "../data/format.ts";
import type { TodayLight } from "../data/today.ts";
import { useExchanges } from "../data/useExchanges.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space, type } from "../theme/tokens.ts";
import { SectionTitle, SoftCard } from "./today-hero.tsx";
import { SecondaryButton, Words } from "./ui.tsx";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from this date to the next Sunday, 0 on a Sunday itself. */
function daysToSunday(date: string): number {
  return (7 - new Date(`${date}T12:00:00Z`).getUTCDay()) % 7;
}

/**
 * The Week page before the first weekly read: when it comes, the parent's own words so far this
 * week, an example of what the read will show (marked as one), and a way to ask something now, so
 * the page is never just an empty promise. Only what the family already sees; no counts of missed
 * days and no health words beyond her own answers, which the family reads in Memories anyway.
 */
export function FirstWeek({ light }: { light: TodayLight }) {
  const p = usePalette();
  const { t } = useLingui();
  const history = useExchanges();
  const name = light.displayName;
  const today = localDateIn(Date.now(), light.timeZone);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  const sunday = addDays(today, daysToSunday(today));
  const when = daysToSunday(today) === 0 ? t`today` : localDayMonth(sunday);
  const answered = history.exchanges.filter(
    (exchange) =>
      exchange.answer !== undefined &&
      (exchange.recipientId === undefined || exchange.recipientId === light.memberId) &&
      exchange.date !== undefined &&
      exchange.date >= monday,
  );
  const count = answered.length;
  const latest = answered.slice(0, 3);

  return (
    <View style={{ gap: space.xl }}>
      <SoftCard tone="paper">
        <View style={{ gap: space.s }}>
          <Words variant="heading">
            <Trans>
              {name}'s first weekly read: {when}
            </Trans>
          </Words>
          <Words variant="body" tone="ink2">
            {count === 0
              ? t`It gathers what ${name} tells the family this week. The more mornings ${name} answers, the richer it gets.`
              : count === 1
                ? t`${name} has answered one morning so far this week. Each answer goes into the read.`
                : t`${name} has answered ${count} mornings so far this week. Each answer goes into the read.`}
          </Words>
        </View>
      </SoftCard>

      {latest.length === 0 ? null : (
        <View style={{ gap: space.m }}>
          <SectionTitle title={t`${name}'s words this week`} />
          {latest.map((exchange) => (
            <SoftCard key={exchange.id}>
              <View style={{ gap: space.xs }}>
                <Text style={[type.caption, { color: p.ink3 }]}>{exchange.day}</Text>
                <Text numberOfLines={4} style={[type.preview, { color: p.ink }]}>
                  {`“${exchange.answer?.text ?? ""}”`}
                </Text>
              </View>
            </SoftCard>
          ))}
        </View>
      )}

      <View style={{ gap: space.m }}>
        <SectionTitle title={t`What the read will show`} />
        <SoftCard>
          <View style={{ gap: space.m }}>
            <Text style={[type.label, { letterSpacing: 0, color: p.ink3 }]}>
              <Trans>Example</Trans>
            </Text>
            <View style={{ gap: space.xs }}>
              <Words variant="body">
                <Trans>5 mornings answered this week</Trans>
              </Words>
              <Words variant="body">
                <Trans>3 replies from the family</Trans>
              </Words>
            </View>
            <View
              style={{
                gap: space.s,
                padding: space.m,
                borderRadius: radius.panel,
                backgroundColor: p.surface2,
              }}
            >
              <Text style={[type.story, { color: p.ink }]}>
                <Trans>
                  The garden came up twice: the tomatoes, and the seeds kept for spring.
                </Trans>
              </Text>
              <Text style={[type.story, { color: p.ink }]}>
                <Trans>Something to ask next: which seeds would be good to plant together?</Trans>
              </Text>
            </View>
          </View>
        </SoftCard>
      </View>

      <SecondaryButton
        label={t`Ask ${name} something for this week`}
        icon="ask"
        onPress={() => router.push({ pathname: "/ask", params: { recipient: light.memberId } })}
      />
    </View>
  );
}
