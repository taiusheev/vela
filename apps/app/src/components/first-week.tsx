import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { localDateIn } from "../data/chat.ts";
import { localDayMonth } from "../data/format.ts";
import type { TodayLight } from "../data/today.ts";
import { useExchanges } from "../data/useExchanges.ts";
import { usePalette } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { Text } from "./scaled-text.tsx";
import { SectionTitle, SoftCard } from "./today-hero.tsx";
import { Words } from "./ui.tsx";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from this date to the next Sunday, 0 on a Sunday itself. */
function daysToSunday(date: string): number {
  return (7 - new Date(`${date}T12:00:00Z`).getUTCDay()) % 7;
}

/**
 * The Week page before the first weekly read: when it comes, the parent's own words so far this
 * week. Everyday support actions follow on the Week screen, so
 * the page offers something useful before the first report. Only what the family already sees; no counts of missed
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
    </View>
  );
}
