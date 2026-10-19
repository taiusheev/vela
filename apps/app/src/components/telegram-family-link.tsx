import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { appPrivacyAcceptance } from "@vela/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { completeTelegramLink, provisionAccount, startTelegramLink } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { connectionCode } from "../data/connection-code.ts";
import { deviceZone } from "../data/onboarding.ts";
import { resetDraft } from "../data/onboarding-draft.ts";
import { space } from "../theme/tokens.ts";
import { BrandHeader } from "./brand/header.tsx";
import { SetupHelp } from "./setup-help.tsx";
import { Card, PrimaryButton, SecondaryButton, SetupProgress, TextField, Words } from "./ui.tsx";

/** A challenge proves this app session and the existing Telegram member control both identities. */
export function TelegramFamilyLink({ noAccount }: { noAccount: boolean }) {
  const { t } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const [enteringCode, setEnteringCode] = useState(false);
  const startKey = useIdempotencyKey("telegram-link");
  const provisionKey = useIdempotencyKey("provision");
  const completeKey = useIdempotencyKey("telegram-link-complete");
  const start = useMutation({
    mutationFn: async () => {
      const token = await account.token();
      if (noAccount) {
        const profile = {
          display_name: name.trim(),
          privacy_acceptance: appPrivacyAcceptance(),
          language: "en" as const,
          tz: deviceZone("Asia/Ho_Chi_Minh"),
        };
        await provisionAccount(profile, provisionKey(profile), token);
        await queries.invalidateQueries({ queryKey: ["me"] });
      }
      return startTelegramLink(startKey({ attempt }), token);
    },
  });
  const [clock, setClock] = useState(Date.now);
  const expiresAt = start.data?.expires_at;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const check = () => setClock(Date.now());
    check();
    const remaining = Date.parse(expiresAt) - Date.now();
    const timer = setTimeout(check, Math.max(0, remaining));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [expiresAt]);
  const complete = useMutation({
    mutationFn: async () => {
      if (start.data === undefined) throw new Error("No link challenge");
      const input = { challenge_id: start.data.challenge_id, code: code.trim() };
      return completeTelegramLink(input, completeKey(input), await account.token());
    },
    onSuccess: async (outcome) => {
      if (!outcome.linked) return;
      resetDraft();
      queries.clear();
      router.replace("/");
    },
  });
  const expired =
    expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= clock);
  const open = async () => {
    if (start.data === undefined) return;
    setOpenFailed(false);
    setEnteringCode(true);
    try {
      await Linking.openURL(start.data.telegram_url);
    } catch {
      setOpenFailed(true);
    }
  };
  return (
    <View style={{ gap: space.l }}>
      <BrandHeader />
      <SetupProgress
        steps={[t`Your family`, t`Your Telegram chat`, t`Connection code`]}
        current={start.data === undefined ? 0 : enteringCode ? 2 : 1}
      />
      <Words variant="title">
        {start.data === undefined
          ? t`Bring your family together`
          : enteringCode
            ? t`Paste your connection code`
            : t`Open your own Telegram chat`}
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>Your email is verified. Now connect the family you already have on Telegram.</Trans>
      </Words>
      {start.data === undefined ? (
        <Card>
          <Words variant="heading">
            <Trans>Already set up with Vela?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>
              Use your own Telegram account, the one in your family. Your parent uses their own chat
              and does not need to register here.
            </Trans>
          </Words>
          <Words variant="caption" tone="ink2">
            <Trans>
              New family? Contact the founder to join the free English pilot. Joining as a relative?
              Join your approved family group first.
            </Trans>
          </Words>
        </Card>
      ) : null}
      {noAccount && start.data === undefined ? (
        <TextField
          label={t`Your name`}
          value={name}
          onChangeText={setName}
          helper={t`Your name, as the family says it.`}
          maxLength={40}
          onSubmit={() => {
            if (!start.isPending && name.trim().length > 0) start.mutate();
          }}
        />
      ) : null}
      {start.data === undefined ? (
        <PrimaryButton
          label={start.isPending ? t`Preparing…` : t`Connect existing family`}
          disabled={start.isPending || (noAccount && name.trim().length === 0)}
          onPress={() => start.mutate()}
        />
      ) : (
        <Card>
          <Words variant="body">
            <Trans>
              In your own Vela chat, tap Start and copy the connection code. Return here to finish.
              Keep this code private.
            </Trans>
          </Words>
          <SecondaryButton
            label={t`Open Vela on Telegram`}
            onPress={() => void open()}
            disabled={expired}
          />
          {openFailed ? (
            <Words variant="body" tone="ink2">
              <Trans>Telegram could not open. Copy this link into Telegram or your browser.</Trans>
            </Words>
          ) : null}
          {openFailed ? (
            <Words variant="caption" selectable>
              {start.data.telegram_url}
            </Words>
          ) : null}
          {!enteringCode ? (
            <SecondaryButton
              label={t`I have my connection code`}
              onPress={() => setEnteringCode(true)}
            />
          ) : null}
          {enteringCode ? (
            <>
              <TextField
                label={t`Connection code`}
                value={code}
                onChangeText={(value) => {
                  setCode(connectionCode(value));
                  complete.reset();
                }}
                placeholder={t`Paste your connection code`}
                helper={
                  code.length > 0 && !/^[A-Za-z0-9_-]{22}$/.test(code)
                    ? t`Paste the full code or the whole message from Vela. It contains 22 characters.`
                    : t`You can paste the whole Telegram message. The code expires after 15 minutes.`
                }
                autoCapitalize="none"
                autoCorrect={false}
                disabled={complete.isPending || expired}
                onSubmit={() => {
                  if (!complete.isPending && !expired && /^[A-Za-z0-9_-]{22}$/.test(code))
                    complete.mutate();
                }}
              />
              <PrimaryButton
                label={complete.isPending ? t`Connecting…` : t`Finish connecting`}
                disabled={complete.isPending || !/^[A-Za-z0-9_-]{22}$/.test(code) || expired}
                onPress={() => complete.mutate()}
              />
            </>
          ) : null}
          {expired ? (
            <Words variant="body" tone="ink2">
              <Trans>This connection expired. Create a new one and use its new code.</Trans>
            </Words>
          ) : null}
          <SecondaryButton
            label={t`Create a new connection`}
            disabled={complete.isPending}
            onPress={() => {
              setAttempt((value) => value + 1);
              setCode("");
              setEnteringCode(false);
              setOpenFailed(false);
              start.reset();
              complete.reset();
            }}
          />
        </Card>
      )}
      {start.isError || complete.isError ? (
        <Words variant="body" tone="ink2">
          <Trans>
            That connection did not go through. Check the code and Telegram account, then try again.
          </Trans>
        </Words>
      ) : null}
      {complete.data?.linked === false ? (
        <Words variant="body" tone="ink2">
          <Trans>
            That code did not connect a family. Use the code from the Telegram account that belongs
            to your approved pilot family.
          </Trans>
        </Words>
      ) : null}
      <SetupHelp />
    </View>
  );
}
