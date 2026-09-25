import { View } from "react-native";
import { languages } from "../data/onboarding.ts";
import { useAppLocale } from "../i18n/provider.tsx";
import { space } from "../theme/tokens.ts";
import { Chip } from "./ui.tsx";

/**
 * The app's language, each offered in its own name (English, 繁體中文), so the right one can be
 * found whichever language the screen is in. On sign-in it applies at once and is remembered; on
 * You it changes the account's language (`useAppLocale().choose`).
 */
export function LocaleChips() {
  const { locale, choose, choosing } = useAppLocale();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {languages.map((choice) => (
        <Chip
          key={choice.value}
          label={choice.label}
          selected={locale === choice.value}
          disabled={choosing}
          onPress={() => choose(choice.value)}
        />
      ))}
    </View>
  );
}
