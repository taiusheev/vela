import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appPrivacyAcceptance } from "@vela/contracts";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import {
  ApiError,
  cancelTelegramLink,
  completeTelegramLink,
  confirmTelegramLink,
  fetchTelegramLinkStatus,
  type LinkChallenge,
  provisionAccount,
  startTelegramLink,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { connectionCode } from "../data/connection-code.ts";
import { deviceZone } from "../data/onboarding.ts";
import { resetDraft } from "../data/onboarding-draft.ts";
import { useConnectionForeground } from "../data/useConnectionForeground.ts";
import { space } from "../theme/tokens.ts";
import { BrandHeader } from "./brand/header.tsx";
import { SetupHelp } from "./setup-help.tsx";
import { Card, PrimaryButton, SecondaryButton, TextField, Words } from "./ui.tsx";

type Messenger = "telegram" | "line";

/** Telegram unless the organiser chose LINE; the apps' own names, never translated. */
const FIRST_MESSENGER: Messenger = "telegram";
const MESSENGER_NAME: Record<Messenger, string> = { telegram: "Telegram", line: "LINE" };

/**
 * Where a connection request opens the organiser's own Vela chat: Telegram as before, or Vela's
 * LINE account when the server offers it (ADR-52). A new family opens the chat with /start alone.
 */
function chatUrl(request: LinkChallenge, messenger: Messenger, newFamily: boolean): string {
  if (messenger === "line" && request.line_url !== undefined) {
    if (!newFamily) return request.line_url;
    const url = new URL(request.line_url);
    url.search = `?${encodeURIComponent("/start")}`;
    return url.toString();
  }
  const url = new URL(request.telegram_url);
  if (newFamily) url.search = "";
  return url.toString();
}

/**
 * Opening the messenger is navigation; explicit approval in the organiser's own Vela chat (Telegram
 * or LINE) and app completion prove both identities.
 */
export function TelegramFamilyLink({ noAccount }: { noAccount: boolean }) {
  const { t, i18n } = useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const active = useConnectionForeground();
  const mounted = useRef(true);
  const opening = useRef(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const attempt = useRef(0);
  const restarting = useRef(false);
  const [manual, setManual] = useState(false);
  const [setup, setSetup] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  // Chosen once the server offers LINE beside Telegram; Telegram alone needs no choice.
  const [via, setVia] = useState<Messenger | null>(null);
  const [clock, setClock] = useState(Date.now);
  const startKey = useIdempotencyKey("telegram-link");
  const provisionKey = useIdempotencyKey("provision");
  const completeKey = useIdempotencyKey("telegram-link-complete");
  const cancelKey = useIdempotencyKey("telegram-link-cancel");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const start = useMutation({
    mutationFn: async (method: "approval" | "code") => {
      const token = await account.token();
      if (noAccount) {
        const profile = {
          display_name: name.trim(),
          privacy_acceptance: appPrivacyAcceptance(),
          language: i18n.locale === "zh-TW" ? ("zh-TW" as const) : ("en" as const),
          tz: deviceZone("Asia/Taipei"),
        };
        await provisionAccount(profile, provisionKey(profile), token);
        await queries.invalidateQueries({ queryKey: ["me"] });
      }
      return startTelegramLink(startKey({ attempt: attempt.current, method }), token, method);
    },
  });
  const challenge = start.data;
  const expiresAt = challenge?.expires_at;
  useEffect(() => {
    if (!active) return;
    setClock(Date.now());
    if (expiresAt === undefined) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, active]);
  const expired =
    expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= clock);
  const status = useQuery({
    queryKey: ["telegram-link-status", account.userId, account.sessionId, challenge?.challenge_id],
    enabled: active && challenge !== undefined && !expired && !setup,
    queryFn: async ({ signal }) =>
      fetchTelegramLinkStatus(challenge?.challenge_id ?? "", await account.token(), signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => {
      const result = query.state.data;
      if (
        result?.state === "expired" ||
        result?.state === "cancelled" ||
        result?.state === "completed"
      )
        return false;
      if (
        query.state.error instanceof ApiError &&
        [401, 403, 404].includes(query.state.error.status)
      )
        return false;
      return query.state.error !== null ||
        Date.now() - (Date.parse(expiresAt ?? "") - 15 * 60_000) > 60_000
        ? 10_000
        : 3_000;
    },
    refetchIntervalInBackground: false,
  });
  const stopped = expired || status.data?.state === "expired" || status.data?.state === "cancelled";
  const approved =
    !status.isError && (status.data?.state === "approved" || status.data?.state === "completed")
      ? status.data
      : undefined;
  const complete = useMutation({
    mutationFn: async (method: "approval" | "code") => {
      if (challenge === undefined) throw new Error("No connection request");
      const token = await account.token();
      if (method === "approval")
        return confirmTelegramLink(
          challenge.challenge_id,
          completeKey({ id: challenge.challenge_id, method }),
          token,
        );
      const input = { challenge_id: challenge.challenge_id, code: code.trim() };
      return completeTelegramLink(input, completeKey(input), token);
    },
    onSuccess: (outcome) => {
      if (!mounted.current || !outcome.linked) return;
      resetDraft();
      queries.clear();
      // Setup's last step: a photo of her for her window, then Today.
      router.replace("/parent-photos");
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (challenge === undefined) return;
      try {
        await cancelTelegramLink(
          challenge.challenge_id,
          cancelKey({ id: challenge.challenge_id }),
          await account.token(),
        );
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    },
    onSuccess: () => {
      if (!mounted.current) return;
      attempt.current += 1;
      setCode("");
      setManual(false);
      setSetup(false);
      setOpenFailed(false);
      setVia(null);
      start.reset();
      complete.reset();
    },
  });
  const open = async (
    request: LinkChallenge,
    newFamily = false,
    messenger = via ?? FIRST_MESSENGER,
  ) => {
    if (!mounted.current) return;
    setOpenFailed(false);
    try {
      await Linking.openURL(chatUrl(request, messenger, newFamily));
    } catch {
      if (mounted.current) setOpenFailed(true);
    }
  };
  const choose = (messenger: Messenger) => {
    setVia(messenger);
    if (challenge !== undefined) void open(challenge, setup, messenger);
  };
  const begin = async (newFamily = false, method: "approval" | "code" = "approval") => {
    if (opening.current) return;
    opening.current = true;
    setSetup(newFamily);
    setManual(method === "code");
    try {
      const request = await start.mutateAsync(method);
      // With LINE offered, the organiser picks where their family's Vela chat is first.
      if (request.line_url === undefined || via !== null) await open(request, newFamily);
    } catch {
      /* The mutation keeps its safe retry state. */
    } finally {
      opening.current = false;
    }
  };
  const linkedMemberName = approved?.member_name ?? "";
  const connectionReference = challenge?.challenge_id.slice(-6).toUpperCase() ?? "";
  const restart = async () => {
    if (restarting.current) return;
    restarting.current = true;
    try {
      await cancel.mutateAsync();
      if (mounted.current) await begin();
    } catch {
      /* Cancellation keeps its retry state. */
    } finally {
      restarting.current = false;
    }
  };
  const failure = start.error ?? complete.error ?? cancel.error ?? status.error;
  const signedOut = failure instanceof ApiError && failure.status === 401;
  const supportReference =
    failure === null
      ? null
      : `${start.error ? "START" : complete.error ? "FINISH" : cancel.error ? "CANCEL" : "CHECK"}-${failure instanceof ApiError ? failure.status : "NETWORK"}`;
  const busy = start.isPending || complete.isPending || cancel.isPending;
  const choosing = challenge?.line_url !== undefined && via === null && !stopped;
  const messenger = MESSENGER_NAME[via ?? FIRST_MESSENGER];
  const shownUrl = challenge === undefined ? "" : chatUrl(challenge, via ?? FIRST_MESSENGER, setup);
  return (
    <View style={{ gap: space.l }}>
      <BrandHeader />
      <Words variant="caption" tone="action">
        {approved ? t`${messenger} confirmed` : t`Your family connection`}
      </Words>
      <Words variant="title">
        {approved
          ? t`Welcome back.`
          : choosing
            ? t`Where is your family’s Vela chat?`
            : setup
              ? t`Start your family in ${messenger}.`
              : challenge === undefined
                ? t`Let’s find your family.`
                : openFailed
                  ? t`${messenger} didn’t open.`
                  : stopped
                    ? t`Let’s try a fresh connection.`
                    : manual
                      ? t`Use your private connection code.`
                      : t`One confirmation, and you’re home.`}
      </Words>
      <Words variant="body" tone="ink2">
        {approved
          ? t`We found your family. Check it below, then finish connecting to this signed-in account.`
          : choosing
            ? t`Choose the app where you chat with Vela. Your family and messages stay together.`
            : setup
              ? t`Send /start in your own Vela chat and follow the setup. Come back here afterwards to connect your family.`
              : challenge === undefined
                ? t`Open your own Vela chat and confirm it’s you. Your family and messages stay together.`
                : stopped
                  ? t`This connection expired or was cancelled. Your family is unchanged.`
                  : manual
                    ? t`Copy the private connection code from your own Vela chat and paste it below. Your parent’s invitation is separate.`
                    : t`In your own Vela chat, check the account and connection reference, then tap Connect my family. Return here to finish. No code to copy.`}
      </Words>
      {noAccount && challenge === undefined ? (
        <TextField
          label={t`Your name`}
          value={name}
          onChangeText={setName}
          maxLength={40}
          helper={t`Your name, as the family says it.`}
        />
      ) : null}
      {challenge === undefined ? (
        <>
          <PrimaryButton
            label={start.isPending ? t`Opening…` : t`Find my family`}
            disabled={busy || (noAccount && name.trim().length === 0)}
            onPress={() => void begin()}
          />
          <Words variant="caption" tone="ink2">
            <Trans>
              Use your own messaging account. Your parent joins from the invitation you send them.
            </Trans>
          </Words>
          <SecondaryButton
            label={t`Set up a new family`}
            disabled={busy || (noAccount && name.trim().length === 0)}
            onPress={() => void begin(true)}
          />
        </>
      ) : approved ? (
        <Card>
          <Words variant="heading">{approved.family_name}</Words>
          <Words variant="body">{t`Connected ${messenger} account: ${linkedMemberName}`}</Words>
          <Words variant="caption" tone="ink2">
            <Trans>Your family’s settings and messages will stay as they are.</Trans>
          </Words>
          <PrimaryButton
            label={complete.isPending ? t`Connecting…` : t`Open my family`}
            disabled={busy || stopped}
            onPress={() => complete.mutate("approval")}
          />
          <SecondaryButton
            label={t`This isn’t my family`}
            disabled={busy}
            onPress={() => cancel.mutate()}
          />
        </Card>
      ) : choosing ? (
        <>
          <PrimaryButton label={t`Open LINE`} disabled={busy} onPress={() => choose("line")} />
          <SecondaryButton
            label={t`Open Telegram`}
            disabled={busy}
            onPress={() => choose("telegram")}
          />
          <SecondaryButton
            label={t`Cancel connection`}
            disabled={busy}
            onPress={() => cancel.mutate()}
          />
        </>
      ) : (
        <>
          {!setup ? (
            <Card>
              {challenge.requester_label ? (
                <Words variant="body">{challenge.requester_label}</Words>
              ) : null}
              <Words
                variant="caption"
                selectable
              >{t`Connection reference: ${connectionReference}`}</Words>
              <Words variant="caption" tone="ink2">
                <Trans>Only confirm a request you just started from your own Vela app.</Trans>
              </Words>
            </Card>
          ) : null}
          {!stopped ? (
            <SecondaryButton
              label={openFailed ? t`Try opening ${messenger} again` : t`Open ${messenger} again`}
              disabled={busy}
              onPress={() => void open(challenge, setup)}
            />
          ) : null}
          {openFailed ? (
            <Words variant="caption" selectable>
              {shownUrl}
            </Words>
          ) : null}
          {setup ? (
            <SecondaryButton
              label={t`Setup finished — connect my family`}
              disabled={busy}
              onPress={() => cancel.mutate()}
            />
          ) : null}
          {!manual && !setup && !stopped ? (
            <SecondaryButton
              label={t`Use a connection code instead`}
              disabled={busy}
              onPress={() => setManual(true)}
            />
          ) : null}
          {manual && !stopped ? (
            <>
              <TextField
                label={t`Connection code`}
                value={code}
                onChangeText={(value) => {
                  setCode(connectionCode(value));
                  complete.reset();
                }}
                autoCapitalize="none"
                autoCorrect={false}
                helper={t`For another device: paste the full code or the whole private ${messenger} message. It expires after 15 minutes.`}
                disabled={busy}
                onSubmit={() => {
                  if (!busy && /^[A-Za-z0-9_-]{22}$/.test(code)) complete.mutate("code");
                }}
              />
              <PrimaryButton
                label={complete.isPending ? t`Connecting…` : t`Connect my family`}
                disabled={busy || !/^[A-Za-z0-9_-]{22}$/.test(code)}
                onPress={() => complete.mutate("code")}
              />
            </>
          ) : null}
          <SecondaryButton
            label={stopped ? t`Create a new connection` : t`Cancel connection`}
            disabled={busy}
            onPress={() => (stopped ? void restart() : cancel.mutate())}
          />
        </>
      )}
      {complete.data?.linked === false ? (
        <Words variant="body" tone="ink2">
          <Trans>
            That confirmation is no longer valid. Try a fresh connection using your own {messenger}{" "}
            account.
          </Trans>
        </Words>
      ) : null}
      {failure !== null ? (
        <>
          <Words variant="body" tone="ink2">
            {signedOut
              ? t`Your sign-in expired. Sign in again to finish connecting.`
              : t`We couldn’t finish connecting. Your family and messages are unchanged. Try again when Vela is available.`}
          </Words>
          {status.isError && !signedOut ? (
            <SecondaryButton
              label={t`Check connection again`}
              disabled={busy}
              onPress={() => void status.refetch()}
            />
          ) : null}
          {start.isError && !signedOut && challenge === undefined ? (
            <SecondaryButton
              label={t`Use a private connection code instead`}
              disabled={busy}
              onPress={() => void begin(false, "code")}
            />
          ) : null}
          <Words variant="caption" tone="ink2" selectable>
            {t`Connection help reference: ${supportReference}`}
          </Words>
        </>
      ) : null}
      <Words variant="caption" tone="ink2">
        <Trans>
          If Vela cannot find your family, check you are using your own account. A family in the
          earlier test version needs help moving to this version; deleting accounts will not move
          it.
        </Trans>
      </Words>
      <SetupHelp />
    </View>
  );
}
