import { View } from "react-native";
import type { TodayLight } from "../data/today.ts";
import { space } from "../theme/tokens.ts";
import { Chip } from "./ui.tsx";

export function ParentChooser({
  lights,
  selected,
  onSelect,
}: {
  lights: readonly TodayLight[];
  selected: string | undefined;
  onSelect(id: string): void;
}) {
  if (lights.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {lights.map((light) => (
        <Chip
          key={light.memberId}
          label={light.displayName}
          selected={light.memberId === selected}
          onPress={() => onSelect(light.memberId)}
        />
      ))}
    </View>
  );
}
