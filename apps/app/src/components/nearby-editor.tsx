import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import type { NearbyView } from "../data/useNearby.ts";
import { hitSlop, space } from "../theme/tokens.ts";
import { ConfirmationDialog } from "./confirmation-dialog.tsx";
import { Card, Hairline, PrimaryButton, SecondaryButton, TextField, Words } from "./ui.tsx";

/**
 * The people nearby one kept-light member (spec A3): who is there, where each one's yes stands,
 * Ask on Telegram for anyone who has not said yes, Remove, and a name and relation to add someone
 * while there is room. Never a number: nobody hears from Vela by being added here, only once they
 * open the link the organiser sends them (ADR-36).
 */
export function NearbyEditor({ name, nearby }: { name: string; nearby: NearbyView }) {
  const { t } = useLingui();
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const whoToRemove = removing?.name ?? "";
  const [person, setPerson] = useState("");
  const [relation, setRelation] = useState("");
  const [shareTrouble, setShareTrouble] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The link goes from the organiser's own phone, in their own words around it: Vela writes to
  // nobody until they open it (ADR-36).
  const askOnTelegram = async (contactId: string, who: string) => {
    setSharing(true);
    setShareTrouble(false);
    try {
      const link = await nearby.invite(contactId);
      if (link === null) return;
      await Share.share({
        message: t`Hello ${who}. Could I list you on Vela as someone near ${name}, so I could ask you to look in on a day ${name} hasn't answered? Open this in Telegram to read what it means and say yes or no: ${link}`,
      });
    } catch {
      setShareTrouble(true);
    } finally {
      setSharing(false);
    }
  };
  const submit = async () => {
    if (await nearby.add(person, relation)) {
      setPerson("");
      setRelation("");
    }
  };

  return (
    <View style={{ gap: space.l }}>
      {nearby.people.length === 0 ? null : (
        <Card>
          {nearby.people.map((contact, index) => {
            const who = contact.name;
            return (
              <View key={contact.id} style={{ gap: space.xs }}>
                {index === 0 ? null : <Hairline />}
                <View
                  style={{
                    gap: space.s,
                    paddingVertical: space.s,
                  }}
                >
                  <View style={{ gap: space.xs }}>
                    <Words variant="bodyMedium">
                      {contact.relation === null
                        ? contact.name
                        : `${contact.name} · ${contact.relation}`}
                    </Words>
                    <Words variant="caption" tone="ink3">
                      {contact.consent}
                    </Words>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.xl }}>
                    {contact.saidYes ? null : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t`Ask ${who} on Telegram`}
                        hitSlop={hitSlop}
                        disabled={nearby.changing || sharing}
                        accessibilityState={{ disabled: nearby.changing || sharing }}
                        style={{ minHeight: 44, justifyContent: "center", maxWidth: "100%" }}
                        onPress={() => void askOnTelegram(contact.id, who)}
                      >
                        <Words variant="button" tone="action">
                          <Trans>Ask on Telegram</Trans>
                        </Words>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t`Remove ${who}`}
                      hitSlop={hitSlop}
                      disabled={nearby.changing || sharing}
                      accessibilityState={{ disabled: nearby.changing || sharing }}
                      style={{ minHeight: 44, justifyContent: "center", maxWidth: "100%" }}
                      onPress={() => setRemoving({ id: contact.id, name: who })}
                    >
                      <Words variant="button" tone="action">
                        <Trans>Remove</Trans>
                      </Words>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      {removing === null ? null : (
        <ConfirmationDialog
          onClose={() => {
            if (!nearby.changing) setRemoving(null);
          }}
        >
          <Words variant="heading">
            <Trans>Remove {whoToRemove} from the people nearby?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>
              They will no longer receive requests to look in. You can invite someone else.
            </Trans>
          </Words>
          <SecondaryButton
            label={t`Confirm removal`}
            disabled={nearby.changing}
            onPress={() => {
              nearby.remove(removing.id);
              setRemoving(null);
            }}
          />
          <SecondaryButton
            label={t`Keep them`}
            disabled={nearby.changing}
            onPress={() => setRemoving(null)}
          />
        </ConfirmationDialog>
      )}
      {nearby.loading ? (
        <Words variant="body" tone="ink2">
          <Trans>Loading the people nearby…</Trans>
        </Words>
      ) : nearby.readFailed ? (
        <SecondaryButton label={t`Try again`} onPress={nearby.refresh} />
      ) : nearby.canAdd || nearby.changing ? (
        <View style={{ gap: space.m }}>
          <TextField
            value={person}
            onChangeText={setPerson}
            placeholder={t`Their name`}
            maxLength={40}
          />
          <TextField
            value={relation}
            onChangeText={setRelation}
            placeholder={t`How they know ${name}, like neighbour`}
            helper={t`No number here: Vela asks them for it, with their yes.`}
            maxLength={40}
            onSubmit={() => void submit()}
          />
          <PrimaryButton
            label={nearby.changing ? t`Adding…` : t`Add them`}
            disabled={!nearby.canAdd || person.trim().length === 0}
            onPress={() => void submit()}
          />
        </View>
      ) : nearby.people.length >= 2 ? (
        <Words variant="caption" tone="ink3">
          <Trans>Two people nearby is the most.</Trans>
        </Words>
      ) : null}
      {shareTrouble ? (
        <Words variant="body" tone="ink2">
          <Trans>
            The invite could not be shared. Try Ask on Telegram again; nobody has been contacted.
          </Trans>
        </Words>
      ) : null}
      {nearby.refused === undefined ? null : (
        <Words variant="body" tone="ink2">
          {nearby.refused}
        </Words>
      )}
    </View>
  );
}
