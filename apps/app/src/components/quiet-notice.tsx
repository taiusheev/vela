import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { QuietNotice } from "../data/quiet.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, sheetShadow, space } from "../theme/tokens.ts";
import { Eyebrow, Hairline, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

interface QuietNoticeSheetProps {
  notice: QuietNotice;
  visible: boolean;
  onFine(): void;
  onWait(): void;
  onClose(): void;
}

/**
 * The one sheet in the system that floats (design system, Elevation), over Today. Ink on surface,
 * never a red banner: it is quiet, not an alarm. It carries the facts, the people who can look in,
 * and the calls the organiser can make, and it closes itself once she answers.
 */
export function QuietNoticeSheet({
  notice,
  visible,
  onFine,
  onWait,
  onClose,
}: QuietNoticeSheetProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const answered = notice.resolution !== undefined;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(30,26,22,0.32)" }}>
        <Pressable accessibilityRole="button" style={{ flex: 1 }} onPress={onClose} />
        <View
          style={[
            {
              backgroundColor: palette.surface,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              paddingTop: space.xl,
              paddingHorizontal: space.margin,
              paddingBottom: insets.bottom + space.xl,
              gap: space.l,
              maxHeight: "86%",
            },
            sheetShadow,
          ]}
        >
          <ScrollView contentContainerStyle={{ gap: space.l }}>
            <Eyebrow>{`USUALLY ANSWERS BY ${notice.usualTime}`}</Eyebrow>
            <Words variant="title">{`It's been quiet at ${notice.memberName}'s today`}</Words>
            {answered ? (
              <Words variant="body">{notice.resolution}</Words>
            ) : (
              <>
                {notice.facts.map((fact) => (
                  <Words key={fact} variant="body" tone="ink2">
                    {fact}
                  </Words>
                ))}
                <Hairline />
                <Words variant="heading">Nearby</Words>
                {notice.contacts.map((contact) => (
                  <View key={contact.id} style={{ gap: space.s }}>
                    <Words variant="bodyMedium">{`${contact.name} · ${contact.relation}`}</Words>
                    <View style={{ flexDirection: "row", gap: space.l }}>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={hitSlop}
                        onPress={() => void Linking.openURL("tel:")}
                      >
                        <Words variant="button" tone="action">
                          Call
                        </Words>
                      </Pressable>
                      {/* Nobody is asked to look in until they have said yes (spec §9). */}
                      {contact.consented ? (
                        <Pressable accessibilityRole="button" hitSlop={hitSlop}>
                          <Words variant="button" tone="action">
                            Ask them to look in
                          </Words>
                        </Pressable>
                      ) : (
                        <Words variant="caption" tone="ink3">
                          Has not said yes yet
                        </Words>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          {answered ? (
            <PrimaryButton label="Close" onPress={onClose} />
          ) : (
            <>
              <PrimaryButton
                label={`Call ${notice.memberName}`}
                onPress={() => void Linking.openURL("tel:")}
              />
              <SecondaryButton label="She's fine, I know why" onPress={onFine} />
              <SecondaryButton label="Wait 2 hours" onPress={onWait} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
