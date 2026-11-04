import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  APP_PRIVACY_TEXTS,
  APP_PRIVACY_VERSION,
  type ApiMe,
  appPrivacyAcceptance,
  privacyLangOf,
} from "@vela/contracts";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiConfigured, provisionAccount } from "../api/client.ts";
import { FAMILY_WAITING_RECHECK_MS, isFamilyWaiting } from "../api/family-waiting.ts";
import { readMe } from "../api/read-me.ts";
import { noticeUrl, SUPPORT_EMAIL } from "../api/support.ts";
import { useAccount } from "../auth/clerk.tsx";
import { privacyGateDecision } from "../data/app-privacy-gate.ts";
import { readDraft, updateDraft, useOnboardingDraft } from "../data/onboarding-draft.ts";
import { retryAccountRead } from "../data/query-client.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { LegalLinks } from "./legal-links.tsx";
import { Light } from "./light.tsx";
import { LoadingLight } from "./loading-light.tsx";
import { Card, PrimaryButton, SecondaryButton, TextButton, Words } from "./ui.tsx";

/** A versioned English notice for the current English testing cohort. */
export function AppPrivacy({
  onAccept,
  onDecline,
  working = false,
  failed = false,
}: {
  onAccept: () => void;
  onDecline: () => void;
  working?: boolean;
  failed?: boolean;
}) {
  const { t, i18n } = useLingui();
  const palette = usePalette();
  const [linkFailed, setLinkFailed] = useState(false);
  const [details, setDetails] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: insets.bottom + space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
      }}
    >
      {/* One lit window, as on every onboarding screen, so this step feels part of the same walk. */}
      <View style={{ alignItems: "flex-start" }}>
        <Light state="lit" height={40} />
      </View>
      <Words variant="title">
        <Trans>Before you continue</Trans>
      </Words>
      <Card>
        <Words variant="body" tone="ink2">
          <Trans>
            Vela saves the family information you choose to share. OpenAI and Deepgram process
            messages and voice notes in the United States to help with questions and weekly reads.
            OpenAI may keep processing logs for up to 30 days. The founder can read exchanges to run
            this private test. Your parent makes their own separate choices.
          </Trans>
        </Words>
      </Card>
      <View style={{ alignItems: "flex-start" }}>
        <TextButton
          label={details ? t`Hide privacy details` : t`Privacy details and terms`}
          onPress={() => setDetails((value) => !value)}
        />
      </View>
      {details ? (
        <>
          <Card>
            <Words selectable>{APP_PRIVACY_TEXTS[privacyLangOf(i18n.locale)]}</Words>
          </Card>
          <LegalLinks />
          <View style={{ alignItems: "flex-start" }}>
            <TextButton
              label={t`Read the privacy notice`}
              onPress={() => {
                void Linking.openURL(noticeUrl("/privacy")).catch(() => setLinkFailed(true));
              }}
            />
          </View>
        </>
      ) : null}
      {linkFailed ? <Words selectable>{SUPPORT_EMAIL}</Words> : null}
      {failed ? (
        <Words>
          <Trans>Your choice could not be saved. Please try again.</Trans>
        </Words>
      ) : null}
      <View style={{ gap: space.s, marginTop: space.l }}>
        <PrimaryButton
          label={working ? t`Saving…` : t`Agree and continue`}
          disabled={working}
          onPress={onAccept}
        />
        <TextButton label={t`Not now`} disabled={working} onPress={onDecline} />
      </View>
    </ScrollView>
  );
}

const SLOW_ACCOUNT_MS = 10_000;

/**
 * A first read that fails is tried again this many times, after these waits, before the screen
 * says the account could not be reached: just after sign-in, or on opening the app again, the
 * phone's connection often needs a moment, and a family should not see an error for that.
 */
export const QUIET_ACCOUNT_RETRIES_MS = [1_000, 2_000, 4_000] as const;

/** Server permission is authoritative; onboarding's explicit choice is saved without asking again. */
export function AppPrivacyGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const scope = `${account.userId}:${account.sessionId ?? ""}`;
  return <ScopedPrivacyGate key={scope}>{children}</ScopedPrivacyGate>;
}

function ScopedPrivacyGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { t, i18n } = useLingui();
  const palette = usePalette();
  const draft = useOnboardingDraft();
  const queries = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const enabled = apiConfigured() && account.ready && account.signedIn;
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => readMe(account),
    enabled,
    retry: false,
    // While the founder has not approved a new family yet, look again now and then, so the app
    // opens by itself once they have.
    refetchInterval: (query) =>
      isFamilyWaiting(query.state.error) ? FAMILY_WAITING_RECHECK_MS : false,
  });
  const missing = me.error instanceof ApiError && me.error.status === 404;
  const waiting = me.data === undefined && isFamilyWaiting(me.error);
  // A failed read is tried again quietly first; the screen goes on loading meanwhile.
  const [quietTries, setQuietTries] = useState(0);
  const quietWait = QUIET_ACCOUNT_RETRIES_MS[quietTries];
  const retryingQuietly =
    me.isError && !missing && !waiting && me.data === undefined && quietWait !== undefined;
  useEffect(() => {
    if (!retryingQuietly || quietWait === undefined) return;
    const timer = setTimeout(() => {
      setQuietTries((tries) => tries + 1);
      void retryAccountRead(queries);
    }, quietWait);
    return () => clearTimeout(timer);
  }, [retryingQuietly, quietWait, queries]);
  useEffect(() => {
    if (me.data !== undefined) setQuietTries(0);
  }, [me.data]);
  const knownMissing = useRef(false);
  if (missing) knownMissing.current = true;
  else if (me.data !== undefined || me.isError) knownMissing.current = false;
  const decision = privacyGateDecision({
    enabled,
    accepted: me.data?.privacy_accepted,
    loading: me.isPending || retryingQuietly,
    missing,
    failed: me.isError && !retryingQuietly,
    localAccepted: draft.privacyAccepted,
    knownMissing: knownMissing.current,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (me.data === undefined) throw new Error("No current account");
      return provisionAccount(
        {
          display_name: me.data.user.display_name,
          language: me.data.user.language,
          tz: me.data.user.tz,
          privacy_acceptance: appPrivacyAcceptance(privacyLangOf(i18n.locale)),
        },
        `privacy:${me.data.user.id}:${APP_PRIVACY_VERSION}`,
        await account.token(),
      );
    },
    onSuccess: (user) => {
      if (!mounted.current) return;
      queries.setQueryData<ApiMe>(["me"], (current) =>
        current?.user.id === user.id ? { ...current, privacy_accepted: true } : current,
      );
      void queries.invalidateQueries({ queryKey: ["me"] });
    },
  });
  // A read still waiting after this long is offered again, so no one is left on a loading screen.
  const [slow, setSlow] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const waitingAttempt = decision === "loading" ? retryAttempt : null;
  useEffect(() => {
    if (waitingAttempt === null) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_ACCOUNT_MS);
    return () => clearTimeout(timer);
  }, [waitingAttempt]);
  const saveChoice = save.mutate;
  useEffect(() => {
    if (decision === "save" && save.status === "idle") saveChoice();
  }, [decision, save.status, saveChoice]);
  if (decision === "pass") return children;
  if (waiting)
    return (
      <FamilyWaiting
        checking={me.isFetching}
        onCheck={() => void retryAccountRead(queries)}
        onSignOut={() => void account.signOut()}
      />
    );
  const decline = () => {
    updateDraft({ privacyAccepted: false });
    void account.signOut();
  };
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {decision === "ask" ? (
        <AppPrivacy onAccept={acceptLocalPrivacy} onDecline={decline} />
      ) : (
        <ScrollView
          style={{ flex: 1, backgroundColor: palette.bg }}
          contentContainerStyle={{ padding: space.margin, paddingTop: space.huge, gap: space.l }}
        >
          {decision === "loading" ? (
            <LoadingLight label={t`Loading your account…`} size="large" />
          ) : null}
          <Words variant="body" tone="ink2">
            {decision === "loading" ? null : decision === "unavailable" ? (
              <Trans>Your account could not be reached. Your privacy choice has not changed.</Trans>
            ) : save.isError ? (
              <Trans>Your choice could not be saved. Please try again.</Trans>
            ) : (
              <Trans>Saving your choice…</Trans>
            )}
          </Words>
          {decision === "loading" && slow ? (
            <Words variant="body" tone="ink2">
              <Trans>This is taking longer than it should.</Trans>
            </Words>
          ) : null}
          {decision === "unavailable" || (decision === "loading" && slow) ? (
            <SecondaryButton
              label={t`Try again`}
              onPress={() => {
                setSlow(false);
                setRetryAttempt((attempt) => attempt + 1);
                void retryAccountRead(queries);
              }}
            />
          ) : save.isError ? (
            <SecondaryButton label={t`Try again`} onPress={() => save.mutate()} />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

export function acceptLocalPrivacy(): void {
  updateDraft({ privacyAccepted: true });
}
export function localPrivacyAccepted(): boolean {
  return readDraft().privacyAccepted;
}

/**
 * What a new organiser sees while the founder has not approved their family yet (ADR-52): their
 * family is set up, a person confirms it, and the app opens by itself afterwards. Never an error.
 */
function FamilyWaiting({
  checking,
  onCheck,
  onSignOut,
}: {
  checking: boolean;
  onCheck: () => void;
  onSignOut: () => void;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
      }}
    >
      <View style={{ alignItems: "flex-start" }}>
        <Light state="lit" height={40} />
      </View>
      <Words variant="title">
        <Trans>Your family is set up</Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          While Vela is in its first test, a person looks at each new family before the first
          morning. That is usually done the same day.
        </Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          Vela will tell you in your messenger when it is done. This page then opens by itself. Keep
          the invite link for your parent until then.
        </Trans>
      </Words>
      <View style={{ alignItems: "flex-start", gap: space.m }}>
        <SecondaryButton
          label={checking ? t`Checking…` : t`Check again`}
          disabled={checking}
          onPress={onCheck}
        />
        <TextButton label={t`Sign out`} onPress={onSignOut} />
      </View>
    </ScrollView>
  );
}
