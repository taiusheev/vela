import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const answered = notice.resolution !== undefined;
  const name = notice.memberName;
  // Her usual hour once it is known, and until then the hour the ask reached her.
  const time = notice.usualTime ?? notice.sentAt;

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
            <Eyebrow>
              {notice.usualTime !== undefined
                ? t`Usually answers by ${time}`
                : time !== undefined
                  ? t`Asked at ${time}`
                  : t`A quiet morning`}
            </Eyebrow>
            <Words variant="title">{t`It's been quiet at ${name}'s today`}</Words>
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
                <Words variant="heading">
                  <Trans>Nearby</Trans>
                </Words>
                {notice.contacts.map((contact) => (
                  <View key={contact.id} style={{ gap: space.s }}>
                    <Words variant="bodyMedium">{`${contact.name} · ${contact.relation}`}</Words>
                    <View style={{ flexDirection: "row", gap: space.l }}>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={hitSlop}
                        onPress={() =>
                          void Linking.openURL(
                            contact.phone === undefined
                              ? "tel:"
                              : `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
                          )
                        }
                      >
                        <Words variant="button" tone="action">
                          <Trans>Call</Trans>
                        </Words>
                      </Pressable>
                      {/* Nobody is asked to look in until they have said yes (spec §9). */}
                      {contact.consented && notice.canAskToCheck !== false ? (
                        <Pressable accessibilityRole="button" hitSlop={hitSlop}>
                          <Words variant="button" tone="action">
                            <Trans>Ask them to look in</Trans>
                          </Words>
                        </Pressable>
                      ) : contact.consented ? null : (
                        <Words variant="caption" tone="ink3">
                          <Trans>Has not said yes yet</Trans>
                        </Words>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          {answered ? (
            <PrimaryButton label={t`Close`} onPress={onClose} />
          ) : (
            <>
              <PrimaryButton label={t`Call ${name}`} onPress={() => void Linking.openURL("tel:")} />
              <SecondaryButton label={t`${name} is fine, I know why`} onPress={onFine} />
              <SecondaryButton label={t`Wait 2 hours`} onPress={onWait} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
