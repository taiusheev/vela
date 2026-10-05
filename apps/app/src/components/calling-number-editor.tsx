import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { callingNumber } from "../data/calling-number.ts";
import { useCallingNumber } from "../data/useCallingNumber.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { Card, Eyebrow, PrimaryButton, SecondaryButton, TextField, Words } from "./ui.tsx";

export function CallingNumberEditor({
  familyId,
  memberId,
  name,
}: {
  familyId: string;
  memberId: string;
  name: string;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const stored = useCallingNumber(familyId, memberId);
  const [input, setInput] = useState("");
  const [permitted, setPermitted] = useState(false);
  useEffect(() => {
    setInput(stored.number ?? "");
    setPermitted(false);
  }, [stored.number]);
  return (
    <Card>
      <Eyebrow>
        <Trans>Optional calling number · {name}</Trans>
      </Eyebrow>
      <Words variant="body" tone="ink2">
        <Trans>
          Ask {name} for permission before saving their number. It stays encrypted on this iPhone,
          is never uploaded to Vela, and is removed when you sign out. Your usual Telegram chat
          still works without it.
        </Trans>
      </Words>
      <TextField
        value={input}
        onChangeText={setInput}
        keyboardType="phone-pad"
        helper={t`Include the country code, starting with +. For example, +84 for Vietnam.`}
        maxLength={24}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
        <View style={{ flex: 1 }}>
          <Words variant="body">
            <Trans>{name} said I may save this number on my iPhone.</Trans>
          </Words>
        </View>
        <Switch
          accessibilityLabel={t`${name} gave permission to save this number`}
          value={permitted}
          onValueChange={setPermitted}
          trackColor={{ false: palette.rule, true: palette.action }}
          thumbColor={palette.surface}
        />
      </View>
      <PrimaryButton
        label={stored.saving ? t`Saving…` : t`Save calling number`}
        disabled={!stored.ready || stored.saving || !permitted || callingNumber(input) === null}
        onPress={() => void stored.save(input, permitted)}
      />
      {stored.number === null ? null : (
        <SecondaryButton
          label={t`Remove calling number`}
          disabled={stored.saving}
          onPress={() => void stored.remove()}
        />
      )}
      {stored.failed ? (
        <Words variant="body" tone="ink2">
          <Trans>The number could not be saved or removed. Try again.</Trans>
        </Words>
      ) : null}
    </Card>
  );
}
