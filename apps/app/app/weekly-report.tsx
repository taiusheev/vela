import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import {
  SUPPORT_NOTICE_VERSION,
  SUPPORT_PERMISSION_TEXT,
  SUPPORT_PERMISSION_VERSION,
  SUPPORT_TEMPLATE_VERSION,
  type SupportKind,
  type SupportPresentation,
  type SupportReport,
} from "@vela/contracts";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import {
  ApiError,
  apiConfigured,
  prepareWeeklySupport,
  writeWeeklySupport,
} from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { accountsConfigured, useAccount } from "../src/auth/clerk.tsx";
import { ScreenHeading } from "../src/components/brand/experience.tsx";
import { SoftCard } from "../src/components/today-hero.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { WarmPage } from "../src/components/warm.tsx";
import { localDayMonth } from "../src/data/format.ts";
import { demoDataAllowed } from "../src/data/live-state.ts";
import { usePullRefresh } from "../src/data/usePullRefresh.ts";
import { useWeeklySupport } from "../src/data/useWeeklySupport.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { space, type } from "../src/theme/tokens.ts";

type Action = "permission" | "review" | "remove" | "stop";
export default function WeeklyReportScreen() {
  const params = useLocalSearchParams<{ family?: string; member?: string }>();
  const account = useAccount();
  if (demoDataAllowed(apiConfigured(), accountsConfigured())) return <ExampleReport />;
  return (
    <LiveReport
      key={`${account.userId}:${params.family}:${params.member}`}
      familyId={params.family ?? ""}
      memberId={params.member ?? ""}
    />
  );
}
function LiveReport({ familyId, memberId }: { familyId: string; memberId: string }) {
  const { t } = useLingui();
  const account = useAccount();
  const query = useWeeklySupport(familyId, memberId);
  const queries = useQueryClient();
  const [presentation, setPresentation] = useState<SupportPresentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const running = useRef(false);
  const epoch = useRef(0);
  const requestKey = useIdempotencyKey("weekly-support");
  const refresh = useCallback(async () => {
    await query.refetch({ cancelRefetch: false });
  }, [query.refetch]);
  const pull = usePullRefresh(refresh);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  async function run(action: Action | "prepare", body: unknown = {}) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const token = await account.token();
      const key = requestKey({ familyId, memberId, action, body, epoch: epoch.current });
      if (action === "prepare")
        setPresentation(await prepareWeeklySupport(familyId, memberId, key, token));
      else {
        await writeWeeklySupport(familyId, memberId, action, body, key, token);
        setPresentation(null);
        await queries.invalidateQueries({ queryKey: ["weekly-support"] });
      }
      epoch.current += 1;
    } catch (error) {
      setPresentation(null);
      setProblem(
        error instanceof ApiError && error.status === 409
          ? t`The message or permission changed. Reload and review it again.`
          : t`That did not save. Try again when you are connected.`,
      );
      await refresh();
    } finally {
      setBusy(false);
      running.current = false;
    }
  }
  const absent = query.error instanceof ApiError && query.error.status === 404;
  return (
    <WarmPage
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeading
        title={t`What would help this week?`}
        subtitle={t`Private test · reviewed family support`}
      />
      {problem ? (
        <Words variant="body" tone="ink2">
          {problem}
        </Words>
      ) : null}
      {busy || query.isPending ? (
        <Words variant="body">
          <Trans>One moment…</Trans>
        </Words>
      ) : query.isError || !query.data ? (
        <>
          <Words variant="body">
            {absent
              ? t`This private report is not available for this account or family.`
              : t`The report could not be reached. Reload to check current access.`}
          </Words>
          <SecondaryButton label={t`Reload report`} onPress={() => void refresh()} />
          {/* Stop is authorised independently of the processing switch or private-test roster. */}
          <SecondaryButton label={t`Stop reports about me`} onPress={() => void run("stop")} />
        </>
      ) : (
        <ReportPanel
          report={query.data}
          presentation={presentation}
          prepare={() => void run("prepare")}
          action={(action, body) => void run(action, body)}
          refresh={() => void refresh()}
        />
      )}
    </WarmPage>
  );
}
export function ReportPanel({
  report,
  presentation,
  prepare,
  action,
  refresh,
}: {
  report: SupportReport;
  presentation: SupportPresentation | null;
  prepare(): void;
  action(action: Action, body: unknown): void;
  refresh(): void;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const [choice, setChoice] = useState<{
    sourceId: string;
    digest: string;
    kind: SupportKind;
  } | null>(null);
  const selectedSource = report.sources.find(
    (s) => s.id === choice?.sourceId && s.digest === choice.digest,
  );
  const chosen = choice && selectedSource ? { source: selectedSource, kind: choice.kind } : null;
  const [confirmed, setConfirmed] = useState(false);
  const [count, setDays] = useState(3);
  const [showSources, setShowSources] = useState(false);
  const [limit, setLimit] = useState(3);
  const dayLabel = (count: number, selected: boolean) =>
    selected ? t`${count} days · selected` : t`${count} days`;
  const title: Record<SupportKind, string> = {
    shared_interest: t`Make time for an interest`,
    company: t`Offer some company`,
    practical_help: t`Offer practical help`,
  };
  const why: Record<SupportKind, string> = {
    shared_interest: t`A family organiser selected these words as an interest to ask about.`,
    company: t`A family organiser selected these words for an optional invitation.`,
    practical_help: t`A family organiser selected these words for an optional offer of help.`,
  };
  const draft: Record<SupportKind, string> = {
    shared_interest: t`Would you like to tell me more about this on our next call?`,
    company: t`Would you like a call or some company? What would suit you?`,
    practical_help: t`Would a little help with this be welcome? Tell me what would work for you.`,
  };
  const name = report.name;
  const readerNames = report.readers.map((r) => r.name).join(", ");
  const untilLabel = (iso: string, reviewer: string) => {
    const date = localDayMonth(iso.slice(0, 10));
    return t`Reviewed by ${reviewer} · available until ${date}`;
  };
  const quote = (source: SupportReport["sources"][number]) => {
    const date = localDayMonth(source.occurred_at.slice(0, 10));
    return (
      <View style={{ gap: space.s }}>
        <Words variant="caption" tone="ink2">{t`${name}'s words · ${date}`}</Words>
        <Text style={[type.story, { color: palette.ink }]}>{`“${source.quote}”`}</Text>
      </View>
    );
  };
  const offer = (source: SupportReport["sources"][number], kind: SupportKind) => {
    setChoice({ sourceId: source.id, digest: source.digest, kind });
    setConfirmed(false);
  };
  const review = () => {
    if (!chosen || !confirmed) return;
    action("review", {
      source_id: chosen.source.id,
      source_digest: chosen.source.digest,
      kind: chosen.kind,
      ordinary_confirmed: true,
      valid_until: new Date(Date.now() + count * 86400000 - 60000).toISOString(),
    });
    setChoice(null);
  };
  return (
    <View style={{ gap: space.l }}>
      <Words variant="heading">{t`${name}'s week`}</Words>
      <Words
        variant="caption"
        tone="ink2"
      >{`${localDayMonth(report.week_start)} – ${localDayMonth(report.week_end)}`}</Words>
      <Words variant="body" tone="ink2">
        <Trans>
          Every offer below was checked by a family organiser. The person receiving the offer
          chooses what feels helpful. Nothing is sent automatically.
        </Trans>
      </Words>
      {report.permission !== "yes" ? (
        <SoftCard>
          <Words variant="body">
            {report.owner
              ? t`You decide whether Vela can help prepare this report from messages you share after agreeing.`
              : t`This report needs the parent's own permission. An organiser cannot agree for them.`}
          </Words>
          {report.owner ? (
            <SecondaryButton label={t`Review who can read my report`} onPress={prepare} />
          ) : null}
        </SoftCard>
      ) : (
        <>
          <Words variant="caption" tone="ink2">{t`Shared with you and: ${readerNames}`}</Words>
          {report.suggestions.length === 0 ? (
            <Words variant="body">
              <Trans>
                No reviewed offers yet. There is limited information here; Vela will not fill the
                gaps with assumptions.
              </Trans>
            </Words>
          ) : (
            report.suggestions.map((item) => (
              <SoftCard key={item.source.id}>
                <View style={{ gap: space.m }}>
                  <Words variant="heading">{title[item.kind]}</Words>
                  {quote(item.source)}
                  <Words variant="body" tone="ink2">
                    {why[item.kind]}
                  </Words>
                  {!report.owner ? (
                    <SecondaryButton
                      label={t`Read the original conversation`}
                      onPress={() =>
                        router.push({
                          pathname: "/exchange/[id]",
                          params: { id: item.source.exchange_id },
                        })
                      }
                    />
                  ) : null}
                  <Words variant="caption" tone="ink2">
                    {untilLabel(item.expires_at, item.reviewed_by)}
                  </Words>
                  {!report.owner ? (
                    <SecondaryButton
                      label={t`Edit an offer before sending`}
                      onPress={() =>
                        router.push({
                          pathname: "/conversation",
                          params: { recipient: report.member_id, suggestion: draft[item.kind] },
                        })
                      }
                    />
                  ) : null}
                  <SecondaryButton
                    label={t`Remove this offer`}
                    onPress={() => action("remove", { source_id: item.source.id })}
                  />
                </View>
              </SoftCard>
            ))
          )}
          {report.can_review ? (
            <>
              <SecondaryButton
                label={showSources ? t`Close message review` : t`Review this week's messages`}
                onPress={() => {
                  setShowSources(!showSources);
                  setChoice(null);
                }}
              />
              {showSources ? (
                <>
                  <Words variant="body" tone="ink2">
                    <Trans>
                      Choose words you understand. Check the whole message for sensitive details and
                      confirm the offer still fits.
                    </Trans>
                  </Words>
                  {report.sources.length === 0 ? (
                    <Words variant="body">
                      <Trans>
                        No eligible messages were shared after permission this week. Nothing needs
                        to be invented.
                      </Trans>
                    </Words>
                  ) : (
                    report.sources.slice(0, limit).map((source) => (
                      <SoftCard key={source.id}>
                        <View style={{ gap: space.s }}>
                          {quote(source)}
                          {(["shared_interest", "company", "practical_help"] as const).map(
                            (kind) => (
                              <SecondaryButton
                                key={kind}
                                label={title[kind]}
                                onPress={() => offer(source, kind)}
                              />
                            ),
                          )}
                        </View>
                      </SoftCard>
                    ))
                  )}
                  {report.sources.length > limit ? (
                    <SecondaryButton
                      label={t`Review more messages`}
                      onPress={() => setLimit(limit + 3)}
                    />
                  ) : null}
                  {chosen ? (
                    <SoftCard>
                      <View style={{ gap: space.m }}>
                        <Words variant="heading">
                          <Trans>Check this offer</Trans>
                        </Words>
                        {quote(chosen.source)}
                        <Words variant="body">{draft[chosen.kind]}</Words>
                        <Words variant="caption" tone="ink2">
                          <Trans>How long will this offer still be relevant?</Trans>
                        </Words>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                          {[1, 3, 7].map((value) => (
                            <SecondaryButton
                              key={value}
                              label={
                                value === count
                                  ? value === 1
                                    ? t`1 day · selected`
                                    : dayLabel(value, true)
                                  : value === 1
                                    ? t`1 day`
                                    : dayLabel(value, false)
                              }
                              onPress={() => setDays(value)}
                            />
                          ))}
                        </View>
                        <SecondaryButton
                          label={
                            confirmed
                              ? t`Review confirmed`
                              : t`I checked: ordinary words, understood, still relevant`
                          }
                          onPress={() => setConfirmed(!confirmed)}
                        />
                        {confirmed ? (
                          <SecondaryButton
                            label={t`Approve this offer for ${count} days`}
                            onPress={review}
                          />
                        ) : null}
                        <SecondaryButton
                          label={t`Discard this draft`}
                          onPress={() => setChoice(null)}
                        />
                      </View>
                    </SoftCard>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {report.owner ? (
            <SecondaryButton label={t`Stop reports about me`} onPress={() => action("stop", {})} />
          ) : null}
        </>
      )}
      {presentation ? (
        <SoftCard>
          <View style={{ gap: space.m }}>
            <Words variant="heading">
              <Trans>Your choice about weekly reports</Trans>
            </Words>
            <Words variant="caption" tone="ink2">
              <Trans>English private-test wording</Trans>
            </Words>
            <Words variant="body">{presentation.text}</Words>
            <Words variant="bodyMedium">
              <Trans>People who can read this report</Trans>
            </Words>
            {presentation.readers.map((reader) => (
              <Words key={reader.id} variant="body">
                {reader.name}
              </Words>
            ))}
            <SecondaryButton
              label={t`I agree for these named people`}
              onPress={() =>
                action("permission", { presentation_id: presentation.id, answer: "yes" })
              }
            />
            <SecondaryButton
              label={t`No, keep reports off`}
              onPress={() =>
                action("permission", { presentation_id: presentation.id, answer: "no" })
              }
            />
          </View>
        </SoftCard>
      ) : null}
      <SecondaryButton label={t`Reload report`} onPress={refresh} />
    </View>
  );
}
const EXAMPLE_MEMBER = "m2";
const EXAMPLE_CHILD = "00000000-0000-4000-8000-000000000002";
function ExampleReport() {
  const { t } = useLingui();
  const [owner, setOwner] = useState(false);
  const [off, setOff] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [presentation, setPresentation] = useState<SupportPresentation | null>(null);
  const source = {
    id: "00000000-0000-4000-8000-000000000003",
    exchange_id: "00000000-0000-4000-8000-000000000004",
    digest: "a".repeat(64),
    quote: t`Could someone help me sort the old photos?`,
    occurred_at: "2026-10-20T01:00:00.000Z",
    occurred_on: "2026-10-20",
  };
  const report: SupportReport = {
    member_id: EXAMPLE_MEMBER,
    name: t`Dad`,
    owner,
    can_review: !owner && !off,
    permission: off ? (owner ? "withdrawn" : "not_shared") : "yes",
    readers: [{ id: EXAMPLE_CHILD, name: "Mia" }],
    week_start: "2026-10-19",
    week_end: "2026-10-25",
    suggestions:
      off || removed
        ? []
        : [
            {
              source,
              kind: "practical_help",
              reviewed_at: "2026-10-21T01:00:00.000Z",
              reviewed_by: "Mia",
              template_version: SUPPORT_TEMPLATE_VERSION,
              expires_at: "2026-10-27T01:00:00.000Z",
            },
          ],
    sources: off || owner ? [] : [source],
  };
  const prepare = () =>
    setPresentation({
      id: "00000000-0000-4000-8000-000000000005",
      version: SUPPORT_PERMISSION_VERSION,
      notice_version: SUPPORT_NOTICE_VERSION,
      text: SUPPORT_PERMISSION_TEXT,
      readers: report.readers,
      expires_at: "2026-10-25T01:00:00.000Z",
    });
  return (
    <WarmPage>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeading
        title={t`What would help this week?`}
        subtitle={t`Example private report · no messages sent`}
      />
      <SecondaryButton
        label={owner ? t`View as family organiser` : t`View as parent`}
        onPress={() => {
          setOwner(!owner);
          setPresentation(null);
        }}
      />
      <ReportPanel
        key={`${owner}:${off}:${removed}`}
        report={report}
        presentation={presentation}
        prepare={prepare}
        refresh={() => {}}
        action={(action, body) => {
          if (action === "stop") {
            setOff(true);
            setPresentation(null);
          }
          if (action === "remove") setRemoved(true);
          if (action === "permission") {
            setOff((body as { answer: string }).answer !== "yes");
            setPresentation(null);
          }
          if (action === "review") setRemoved(false);
        }}
      />
    </WarmPage>
  );
}
