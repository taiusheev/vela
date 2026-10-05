import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { completeTelegramLink, provisionAccount, startTelegramLink } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { deviceZone } from "../data/onboarding.ts";
import { space } from "../theme/tokens.ts";
import { Card, PrimaryButton, SecondaryButton, TextField, Words } from "./ui.tsx";

/** A challenge proves this app session and the existing Telegram member control both identities. */
export function TelegramFamilyLink({ noAccount }: { noAccount: boolean }) {
  const { t } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const startKey = useIdempotencyKey("telegram-link");
  const provisionKey = useIdempotencyKey("provision");
  const completeKey = useIdempotencyKey("telegram-link-complete");
  const start = useMutation({
    mutationFn: async () => {
      const token = await account.token();
      if (noAccount) {
        const profile = {
          display_name: name.trim(),
          language: "en" as const,
          tz: deviceZone("Asia/Ho_Chi_Minh"),
        };
        await provisionAccount(profile, provisionKey(profile), token);
        await queries.invalidateQueries({ queryKey: ["me"] });
      }
      return startTelegramLink(startKey({ attempt }), token);
    },
  });
  const complete = useMutation({
    mutationFn: async () => {
      if (start.data === undefined) throw new Error("No link challenge");
      const input = { challenge_id: start.data.challenge_id, code: code.trim() };
      return completeTelegramLink(input, completeKey(input), await account.token());
    },
    onSuccess: async (outcome) => {
      if (!outcome.linked) return;
      queries.clear();
      router.replace("/");
    },
  });
  const expired =
    start.data !== undefined && new Date(start.data.expires_at).getTime() <= Date.now();
  const open = async () => {
    if (start.data === undefined) return;
    setOpenFailed(false);
    try {
      await Linking.openURL(start.data.telegram_url);
    } catch {
      setOpenFailed(true);
    }
  };
  return (
    <View style={{ gap: space.l }}>
      <Words variant="title">
        <Trans>Connect your Telegram family</Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          The free English pilot starts with the founder setting up your family on Telegram. Connect
          that same family here to ask and reply on your iPhone.
        </Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>
          If your family has not been set up yet, contact the founder before continuing. Your parent
          agrees in their own Telegram chat.
        </Trans>
      </Words>
      {noAccount && start.data === undefined ? (
        <TextField
          value={name}
          onChangeText={setName}
          helper={t`Your name, as the family says it.`}
          maxLength={40}
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
              Open Telegram with the account that already belongs to your approved pilot family. Tap
              Start, copy the connection code Vela sends you, and paste it below.
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
          <Words variant="caption" selectable>
            {start.data.telegram_url}
          </Words>
          <TextField
            value={code}
            onChangeText={setCode}
            helper={t`Connection code from your own Vela chat. It expires after 15 minutes.`}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={22}
          />
          <PrimaryButton
            label={complete.isPending ? t`Connecting…` : t`Finish connecting`}
            disabled={complete.isPending || code.trim().length !== 22 || expired}
            onPress={() => complete.mutate()}
          />
          {expired ? (
            <Words variant="body" tone="ink2">
              <Trans>This connection expired. Create a new one and use its new code.</Trans>
            </Words>
          ) : null}
          <SecondaryButton
            label={t`Create a new connection`}
            onPress={() => {
              setAttempt((value) => value + 1);
              setCode("");
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
    </View>
  );
}
