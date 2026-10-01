import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { NearbyView } from "../data/useNearby.ts";
import { hitSlop, space } from "../theme/tokens.ts";
import { Card, Hairline, PrimaryButton, TextField, Words } from "./ui.tsx";

/**
 * The people nearby one kept-light member (spec A3): who is there, where each one's yes stands,
 * Remove, and a name and relation to add someone while there is room. Never a number: the founder
 * asks each one and adds the number with their yes, so nobody hears from Vela by being added here.
 */
export function NearbyEditor({ name, nearby }: { name: string; nearby: NearbyView }) {
  const { t } = useLingui();
  const [person, setPerson] = useState("");
  const [relation, setRelation] = useState("");
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
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: space.m,
                  }}
                >
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Words variant="bodyMedium">
                      {contact.relation === null
                        ? contact.name
                        : `${contact.name} · ${contact.relation}`}
                    </Words>
                    <Words variant="caption" tone="ink3">
                      {contact.consent}
                    </Words>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Remove ${who}`}
                    hitSlop={hitSlop}
                    disabled={nearby.changing}
                    onPress={() => nearby.remove(contact.id)}
                  >
                    <Words variant="button" tone="action">
                      <Trans>Remove</Trans>
                    </Words>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      {nearby.canAdd || nearby.changing ? (
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
            onPress={() => void submit()}
          />
        </View>
      ) : (
        <Words variant="caption" tone="ink3">
          <Trans>Two people nearby is the most.</Trans>
        </Words>
      )}
      {nearby.refused === undefined ? null : (
        <Words variant="body" tone="ink2">
          {nearby.refused}
        </Words>
      )}
    </View>
  );
}
