import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Share } from "react-native";
import { prepareParentLink } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

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
  const key = useIdempotencyKey("parent-link");
  const [attempt, setAttempt] = useState(0);
  const [shareFailed, setShareFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const link = useMutation({
    mutationFn: async (generation: number) =>
      prepareParentLink(
        familyId,
        memberId,
        key({ familyId, memberId, attempt: generation }),
        await account.token(),
      ),
  });
  const share = async () => {
    if (!link.data) return;
    setShareFailed(false);
    if (link.data.expires_at !== null && Date.parse(link.data.expires_at) <= Date.now()) {
      setExpired(true);
      return;
    }
    try {
      await Share.share({ message: link.data.text });
    } catch {
      setShareFailed(true);
    }
  };
  return (
    <Card>
      <Eyebrow>
        <Trans>Parent link</Trans>
      </Eyebrow>
      <Words variant="heading">{t`Send ${name} the link again`}</Words>
      <Words variant="body" tone="ink2">
        <Trans>
          You can share this after setup, whenever you need it. Your parent answers in their own
          chat.
        </Trans>
      </Words>
      {!live ? (
        <Words variant="caption" tone="ink2">
          <Trans>This is an example family. No invitation is created or sent.</Trans>
        </Words>
      ) : link.data === undefined ? (
        <PrimaryButton
          label={
            link.isPending
              ? t`Preparing link…`
              : link.isError
                ? t`Try again`
                : t`Prepare parent link`
          }
          disabled={link.isPending}
          onPress={() => link.mutate(attempt)}
        />
      ) : (
        <>
          <Words variant="body" tone="ink2">
            {link.data.kind === "invite"
              ? t`This invitation is for ${name}. Sharing it does not turn on their light; they decide in their own chat.`
              : t`${name} already has a chat with Vela. This link opens that chat without registering again.`}
          </Words>
          <Words variant="caption" selectable>
            {link.data.url}
          </Words>
          <PrimaryButton label={t`Share link`} disabled={expired} onPress={() => void share()} />
          {expired ? (
            <Words variant="body" tone="ink2">
              <Trans>This invitation has expired. Refresh the link before sharing it.</Trans>
            </Words>
          ) : null}
          <Words variant="caption" tone="ink2">
            <Trans>
              Opening the share sheet does not confirm delivery. Choose your parent and send it
              there.
            </Trans>
          </Words>
          <SecondaryButton
            label={t`Refresh link`}
            onPress={() => {
              const next = attempt + 1;
              setAttempt(next);
              link.mutate(next);
              setShareFailed(false);
              setExpired(false);
            }}
          />
        </>
      )}
      {link.isError ? (
        <Words variant="body" tone="ink2">
          <Trans>
            The link could not be prepared. Your family is unchanged. Try again or get help.
          </Trans>
        </Words>
      ) : null}
      {shareFailed ? (
        <Words variant="body" tone="ink2">
          <Trans>
            This device could not open sharing. Select and copy the link above, then send it to your
            parent.
          </Trans>
        </Words>
      ) : null}
    </Card>
  );
}
