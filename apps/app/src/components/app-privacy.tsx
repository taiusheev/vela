import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { APP_PRIVACY_TEXT, appPrivacyAcceptance } from "@vela/contracts";
import type { ReactNode } from "react";
import { useState } from "react";
import { Linking, Modal, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, apiBaseUrl, apiConfigured, fetchMe, provisionAccount } from "../api/client.ts";
import { PRODUCTION_NOTICE_ORIGIN, SUPPORT_EMAIL } from "../api/support.ts";
import { useAccount } from "../auth/clerk.tsx";
import {
  readDraft,
  updateDraft,
  updateDraftForRun,
  useOnboardingDraft,
} from "../data/onboarding-draft.ts";
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
      <Card>
        <Words selectable>{APP_PRIVACY_TEXT}</Words>
      </Card>
      <LegalLinks />
      {linkFailed ? <Words selectable>{SUPPORT_EMAIL}</Words> : null}
      <SecondaryButton
        label={t`Read the privacy notice`}
        onPress={() => {
          void Linking.openURL(`${apiBaseUrl ?? PRODUCTION_NOTICE_ORIGIN}/privacy`).catch(() =>
            setLinkFailed(true),
          );
        }}
      />
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

/** Ask existing signed-in testers for the current app permission; keep navigation mounted. */
export function AppPrivacyGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const draft = useOnboardingDraft();
  const queries = useQueryClient();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const enabled = apiConfigured() && account.ready && account.signedIn;
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => fetchMe(await account.token()),
    enabled,
    retry: false,
  });
  if (!enabled) return children;
  // New accounts collect a name at onboarding; the same versioned permission travels with provisioning.
  const newAccount = me.error instanceof ApiError && me.error.status === 404;
  if (newAccount && draft.privacyAccepted) return children;
  if (me.data?.privacy_accepted === true) return children;
  const accept = async () => {
    if (newAccount) {
      acceptLocalPrivacy();
      return;
    }
    if (working || !me.data) return;
    const run = draft.run;
    setWorking(true);
    setFailed(false);
    try {
      await provisionAccount(
        {
          display_name: me.data.user.display_name,
          language: me.data.user.language,
          tz: me.data.user.tz,
          privacy_acceptance: appPrivacyAcceptance(),
        },
        `privacy:${me.data.user.id}:v1`,
        await account.token(),
      );
      updateDraftForRun(run, { privacyAccepted: true });
      await queries.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      {children}
      <Modal
        visible
        onRequestClose={() => {
          void account.signOut();
        }}
      >
        <AppPrivacy
          working={working || me.isPending}
          failed={failed || (me.isError && !newAccount)}
          onAccept={() => {
            if (me.isError && !newAccount) {
              void me.refetch();
              return;
            }
            void accept();
          }}
          onDecline={() => {
            updateDraft({ privacyAccepted: false });
            void account.signOut();
          }}
        />
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
