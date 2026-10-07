import { Trans } from "@lingui/react/macro";
import { View } from "react-native";
import type { TodayView } from "../data/useToday.ts";
import { space } from "../theme/tokens.ts";
import { Chip, Words } from "./ui.tsx";

export function FamilyChooser({ day }: { day: TodayView }) {
  if (day.families.length < 2) return null;
  return (
    <View style={{ gap: space.s }}>
      <Words variant="caption" tone="ink2">
        <Trans>Your family</Trans>
      </Words>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
        {day.families.map((family) => (
          <Chip
            key={family.id}
            label={family.name}
            selected={family.id === day.familyId}
            onPress={() => day.selectFamily(family.id)}
          />
        ))}
      </View>
    </View>
  );
}
