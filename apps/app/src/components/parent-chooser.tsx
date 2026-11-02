import { View } from "react-native";
import type { TodayLight } from "../data/today.ts";
import { space } from "../theme/tokens.ts";
import { Chip } from "./ui.tsx";

/** The first letter or character of a name, as a messenger's face: "Mom" → "M", "媽媽" → "媽". */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "";
}

export function ParentChooser({
  lights,
  selected,
  onSelect,
  everyone,
}: {
  lights: readonly TodayLight[];
  selected: string | undefined;
  onSelect(id: string): void;
  /**
   * A first chip for "no parent chosen", where nothing chosen means every parent (Memories), so
   * the row always shows which words are on screen.
   */
  everyone?: { label: string; onSelect(): void };
}) {
  if (lights.length < 2) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {everyone === undefined ? null : (
        <Chip
          label={everyone.label}
          selected={selected === undefined}
          onPress={everyone.onSelect}
          initials={lights
            .slice(0, 2)
            .map((light) => ({ key: light.memberId, initial: initialOf(light.displayName) }))}
        />
      )}
      {lights.map((light) => (
        <Chip
          key={light.memberId}
          label={light.displayName}
          initials={[{ key: light.memberId, initial: initialOf(light.displayName) }]}
          selected={light.memberId === selected}
          onPress={() => onSelect(light.memberId)}
        />
      ))}
    </View>
  );
}
