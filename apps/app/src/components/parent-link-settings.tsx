import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import { fetchParentConnection, prepareParentLink } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { useConnectionForeground } from "../data/useConnectionForeground.ts";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/** Preparing and sharing is one deliberate action; the server reuses/renews the same parent's link. */
export function ParentLinkSettings({
  familyId,
  memberId,
  name,
  live,
}: {
  familyId: string;
  memberId: string;
  name: string;
  live: boolean;
}) {
  const { t } = useLingui();
  const account = useAccount();
  const active = useConnectionForeground();
  const key = useIdempotencyKey("parent-link");
  const generation = useRef(0);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [sharing, setSharing] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [shared, setShared] = useState(false);
  const status = useQuery({
    queryKey: ["parent-connection", account.userId, account.sessionId, familyId, memberId],
    enabled: live && active,
    queryFn: async ({ signal }) =>
      fetchParentConnection(familyId, memberId, await account.token(), signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      query.state.data?.state === "declined" || query.state.data?.state === "unavailable"
        ? false
        : query.state.error === null
          ? 5_000
          : 15_000,
    refetchIntervalInBackground: false,
  });
  const link = useMutation({
    mutationFn: async () =>
      prepareParentLink(
        familyId,
        memberId,
        key({ familyId, memberId, attempt: generation.current }),
        await account.token(),
      ),
  });
  const state = !status.isError ? status.data?.state : undefined;
  const connected = state === "connected" || state === "paused";
  const unavailable = state === "declined" || state === "unavailable";
  const share = async () => {
    if (!live || running.current || unavailable) return;
    running.current = true;
    setSharing(true);
    setShareFailed(false);
    try {
      // A new deliberate share rechecks acceptance and expiry; a failed request retries its key.
      const prepared = await link.mutateAsync();
      generation.current += 1;
      if (!mounted.current) return;
      const result = await Share.share({ message: prepared.text });
      if (mounted.current) setShared(result?.action === Share.sharedAction);
      void status.refetch();
    } catch {
      if (mounted.current) setShareFailed(true);
    } finally {
      running.current = false;
      if (mounted.current) setSharing(false);
    }
  };
  return (
    <Card>
      <Eyebrow>
        <Trans>Family connection</Trans>
      </Eyebrow>
      <Words variant="heading">
        {state === "connected"
          ? t`You and ${name} are connected.`
          : state === "paused"
            ? t`${name} has paused their mornings.`
            : state === "opened"
              ? t`${name} opened the invitation.`
              : state === "declined"
                ? t`${name} chose “Not now”.`
                : state === "unavailable"
                  ? t`This connection needs attention.`
                  : t`An invitation for ${name}`}
      </Words>
      <Words variant="body" tone="ink2">
        {state === "connected"
          ? t`They joined in their own chat. Share a shortcut whenever they need to find Vela again; no new registration.`
          : state === "paused"
            ? t`Their chat is still connected, and morning messages are paused. They can say start in that chat when they want to resume.`
            : state === "opened"
              ? t`They still need to choose whether to join. Opening the link does not give consent.`
              : state === "declined"
                ? t`Morning messages are off. Give them time; another invitation will still need their own agreement.`
                : state === "unavailable"
                  ? t`We can’t confirm an available chat for this parent. Check with them before trying to invite again.`
                  : t`Share one personal link in your usual chat. Your parent decides in Telegram or LINE and does not need to register in the app.`}
      </Words>
      {!live ? (
        <Words variant="caption" tone="ink2">
          <Trans>This is an example family. No invitation is created or sent.</Trans>
        </Words>
      ) : (
        <>
          {status.isPending ? (
            <Words variant="caption" tone="ink2">
              <Trans>Checking the family connection…</Trans>
            </Words>
          ) : null}
          {status.isError ? (
            <Words variant="caption" tone="ink2">
              <Trans>
                The connection status could not be checked. This does not mean your parent has
                disconnected.
              </Trans>
            </Words>
          ) : null}
          {!unavailable ? (
            <PrimaryButton
              label={
                sharing
                  ? t`Opening sharing…`
                  : connected
                    ? t`Share their chat link`
                    : shared
                      ? t`Share invitation again`
                      : t`Send their invitation`
              }
              disabled={sharing || link.isPending}
              onPress={() => void share()}
            />
          ) : null}
          <SecondaryButton
            label={t`Check connection again`}
            disabled={status.isFetching || sharing}
            onPress={() => void status.refetch()}
          />
          {shared ? (
            <Words variant="caption" tone="ink2">
              <Trans>
                You chose to share the link. Delivery is not confirmed; Vela will show when your
                parent agrees.
              </Trans>
            </Words>
          ) : null}
          {state === "connected" ? (
            <Words variant="caption" tone="ink2">
              <Trans>A connection is not a delivered morning message or a reply.</Trans>
            </Words>
          ) : null}
        </>
      )}
      {link.isError ? (
        <Words variant="body" tone="ink2">
          <Trans>
            The link could not be prepared. Your family is unchanged. Try again or get help.
          </Trans>
        </Words>
      ) : null}
      {shareFailed && link.data ? (
        <>
          <Words variant="body" tone="ink2">
            <Trans>
              Sharing could not open. Select and copy the link below, then send it to your parent.
              If it has expired, try sharing again for a fresh link.
            </Trans>
          </Words>
          <Words variant="caption" selectable>
            {link.data.url}
          </Words>
        </>
      ) : null}
    </Card>
  );
}
