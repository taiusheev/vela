import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  APP_PRIVACY_TEXT,
  APP_PRIVACY_VERSION,
  type ApiMe,
  appPrivacyAcceptance,
} from "@vela/contracts";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiBaseUrl, apiConfigured, fetchMe, provisionAccount } from "../api/client.ts";
import { PRODUCTION_NOTICE_ORIGIN, SUPPORT_EMAIL } from "../api/support.ts";
import { useAccount } from "../auth/clerk.tsx";
import { privacyGateDecision } from "../data/app-privacy-gate.ts";
import { readDraft, updateDraft, useOnboardingDraft } from "../data/onboarding-draft.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { LegalLinks } from "./legal-links.tsx";
import { Card, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

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
  const { t } = useLingui();
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
      <Words variant="title">
        <Trans>Before you continue</Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          Vela saves the family information you choose to share. OpenAI and Deepgram process
          messages and voice notes in the United States to help with questions and weekly reads.
          OpenAI may keep processing logs for up to 30 days. The founder can read exchanges to run
          this private test. Your parent makes their own separate choices.
        </Trans>
      </Words>
      <SecondaryButton
        label={details ? t`Hide privacy details` : t`Privacy details and terms`}
        onPress={() => setDetails((value) => !value)}
      />
      {details ? (
        <>
          <Card>
            <Words selectable>{APP_PRIVACY_TEXT}</Words>
          </Card>
          <LegalLinks />
        </>
      ) : null}
      {linkFailed ? <Words selectable>{SUPPORT_EMAIL}</Words> : null}
      {details ? (
        <SecondaryButton
          label={t`Read the privacy notice`}
          onPress={() => {
            void Linking.openURL(`${apiBaseUrl ?? PRODUCTION_NOTICE_ORIGIN}/privacy`).catch(() =>
              setLinkFailed(true),
            );
          }}
        />
      ) : null}
      {failed ? (
        <Words>
          <Trans>Your choice could not be saved. Please try again.</Trans>
        </Words>
      ) : null}
      <PrimaryButton
        label={working ? t`Saving…` : t`Agree and continue`}
        disabled={working}
        onPress={onAccept}
      />
      <SecondaryButton label={t`Not now`} disabled={working} onPress={onDecline} />
    </ScrollView>
  );
}

/** Server permission is authoritative; onboarding's explicit choice is saved without asking again. */
export function AppPrivacyGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const scope = `${account.userId}:${account.sessionId ?? ""}`;
  return <ScopedPrivacyGate key={scope}>{children}</ScopedPrivacyGate>;
}

function ScopedPrivacyGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { t } = useLingui();
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
    queryFn: async () => fetchMe(await account.token()),
    enabled,
    retry: false,
  });
  const missing = me.error instanceof ApiError && me.error.status === 404;
  const decision = privacyGateDecision({
    enabled,
    accepted: me.data?.privacy_accepted,
    loading: me.isPending,
    missing,
    failed: me.isError,
    localAccepted: draft.privacyAccepted,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (me.data === undefined) throw new Error("No current account");
      return provisionAccount(
        {
          display_name: me.data.user.display_name,
          language: me.data.user.language,
          tz: me.data.user.tz,
          privacy_acceptance: appPrivacyAcceptance(),
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
  const saveChoice = save.mutate;
  useEffect(() => {
    if (decision === "save" && save.status === "idle") saveChoice();
  }, [decision, save.status, saveChoice]);
  if (decision === "pass") return children;
  const decline = () => {
    updateDraft({ privacyAccepted: false });
    void account.signOut();
  };
  return (
    <>
      {children}
      <Modal visible onRequestClose={decline}>
        {decision === "ask" ? (
          <AppPrivacy onAccept={acceptLocalPrivacy} onDecline={decline} />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: space.margin, paddingTop: space.huge, gap: space.l }}
          >
            <Words variant="body" tone="ink2">
              {decision === "loading" ? (
                <Trans>Loading your account…</Trans>
              ) : decision === "unavailable" ? (
                <Trans>
                  Your account could not be reached. Your privacy choice has not changed.
                </Trans>
              ) : save.isError ? (
                <Trans>Your choice could not be saved. Please try again.</Trans>
              ) : (
                <Trans>Saving your choice…</Trans>
              )}
            </Words>
            {decision === "unavailable" ? (
              <SecondaryButton label={t`Try again`} onPress={() => void me.refetch()} />
            ) : save.isError ? (
              <SecondaryButton label={t`Try again`} onPress={() => save.mutate()} />
            ) : null}
          </ScrollView>
        )}
      </Modal>
    </>
  );
}

export function acceptLocalPrivacy(): void {
  updateDraft({ privacyAccepted: true });
}
export function localPrivacyAccepted(): boolean {
  return readDraft().privacyAccepted;
}
