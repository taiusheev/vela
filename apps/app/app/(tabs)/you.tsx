import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccount } from "../../src/auth/clerk.tsx";
import { Card, Eyebrow, Hairline, SecondaryButton, Words } from "../../src/components/ui.tsx";
import { useToday } from "../../src/data/useToday.ts";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function YouScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { familyId, live, trouble, noAccount } = useToday();

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      <Words variant="title">You</Words>

      {account.signedIn ? (
        <Card>
          <Eyebrow>SIGNED IN</Eyebrow>
          {/* The id the development seed takes, so setting a family up needs no dashboard. */}
          <Words variant="bodyMedium" selectable>
            {account.userId ?? "—"}
          </Words>
          <Words variant="caption" tone="ink3">
            Your account id. Nobody but you needs it.
          </Words>
          <Hairline />
          {live && familyId !== undefined ? (
            <>
              <Words variant="body" tone="ink2">
                Your family is on this account.
              </Words>
              <Words variant="caption" tone="ink3" selectable>
                {familyId}
              </Words>
            </>
          ) : (
            <Words variant="body" tone="ink2">
              {noAccount
                ? "No family is set up on this account yet."
                : trouble
                  ? "Your family could not be reached just now."
                  : "Looking for your family on this account…"}
            </Words>
          )}
        </Card>
      ) : (
        <Words variant="body" tone="ink2">
          You are not signed in, so this is the example day.
        </Words>
      )}

      <Words variant="body" tone="ink2">
        The rest of this screen is not built yet.
      </Words>

      {account.signedIn ? (
        <SecondaryButton label="Sign out" onPress={() => void account.signOut()} />
      ) : null}
    </ScrollView>
  );
}
