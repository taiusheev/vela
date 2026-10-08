import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { callingNumber as validCallingNumber } from "../data/calling-number.ts";
import type { QuietNotice } from "../data/quiet.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, sheetShadow, space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Eyebrow, Hairline, PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

interface QuietNoticeSheetProps {
  notice: QuietNotice;
  visible: boolean;
  onFine(): void;
  onWait(): void;
  /** Ask one person nearby to look in (ADR-36); absent where nobody can be asked from here. */
  onAskToLookIn?(contactId: string): void;
  asking?: boolean;
  settling?: boolean;
  callingNumber?: string;
  trouble?: boolean;
  /** The organiser's verdict once the morning is settled (spec §18). */
  onUseful?(useful: boolean): void;
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
  onAskToLookIn,
  asking = false,
  onUseful,
  onClose,
  settling = false,
  callingNumber,
  trouble = false,
}: QuietNoticeSheetProps) {
  const palette = usePalette();
  const [callFailed, setCallFailed] = useState(false);
  const call = async (phone: string) => {
    setCallFailed(false);
    const number = validCallingNumber(phone);
    if (number === null) {
      setCallFailed(true);
      return;
    }
    try {
      await Linking.openURL(`tel:${number}`);
    } catch {
      setCallFailed(true);
    }
  };
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const answered = notice.resolution !== undefined;
  const name = notice.memberName;
  // Her usual hour once it is known, and until then the hour the ask reached her.
  const time = notice.usualTime ?? notice.sentAt;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(30,26,22,0.32)" }}>
        <Pressable
          accessible={false}
          focusable={false}
          tabIndex={-1}
          style={{ flex: 1 }}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
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
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: space.l }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
              <View style={{ flex: 1 }}>
                <Eyebrow>
                  {notice.usualTime !== undefined
                    ? t`Usually answers by ${time}`
                    : time !== undefined
                      ? t`Asked at ${time}`
                      : t`A quiet morning`}
                </Eyebrow>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t`Close quiet notice`}
                onPress={onClose}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <BrandIcon name="close" color={palette.ink2} />
              </Pressable>
            </View>
            <Words
              variant="title"
              accessibilityRole="header"
            >{t`It's been quiet at ${name}'s today`}</Words>
            {answered ? (
              <>
                <Words variant="body">{notice.resolution}</Words>
                {onUseful === undefined ? null : notice.useful === true ||
                  notice.useful === false ? (
                  <Words variant="caption" tone="ink3">
                    <Trans>Thank you. That helps Vela tell quiet mornings apart.</Trans>
                  </Words>
                ) : (
                  <View style={{ gap: space.s }}>
                    <Words variant="bodyMedium">
                      <Trans>Was this notice useful?</Trans>
                    </Words>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.l }}>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={hitSlop}
                        disabled={settling}
                        style={{ minHeight: 44, justifyContent: "center" }}
                        onPress={() => onUseful(true)}
                      >
                        <Words variant="button" tone="action">
                          <Trans>Yes, useful</Trans>
                        </Words>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={hitSlop}
                        disabled={settling}
                        style={{ minHeight: 44, justifyContent: "center" }}
                        onPress={() => onUseful(false)}
                      >
                        <Words variant="button" tone="action">
                          <Trans>Not this time</Trans>
                        </Words>
                      </Pressable>
                    </View>
                  </View>
                )}
              </>
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
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.l }}>
                      {contact.phone === undefined ||
                      validCallingNumber(contact.phone) === null ? null : (
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={hitSlop}
                          style={{ minHeight: 44, justifyContent: "center" }}
                          onPress={() => void call(contact.phone ?? "")}
                        >
                          <Words variant="button" tone="action">
                            <Trans>Call</Trans>
                          </Words>
                        </Pressable>
                      )}
                      {/* Nobody is asked to look in until they have said yes (spec §9). */}
                      {contact.asked !== undefined ? (
                        <Words variant="caption" tone="ink2">
                          {askedLine(contact.name, contact.asked)}
                        </Words>
                      ) : contact.canAsk === true && onAskToLookIn !== undefined ? (
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={hitSlop}
                          disabled={asking || settling}
                          style={{ minHeight: 44, justifyContent: "center" }}
                          onPress={() => onAskToLookIn(contact.id)}
                        >
                          <Words variant="button" tone="action">
                            {asking ? t`Asking…` : t`Ask them to look in`}
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
            {trouble || callFailed ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  That action did not go through. Try again, or contact the person directly.
                </Trans>
              </Words>
            ) : null}
            {answered ? (
              <PrimaryButton label={t`Close`} onPress={onClose} />
            ) : (
              <>
                {callingNumber === undefined ? (
                  <Words variant="body" tone="ink2">
                    <Trans>
                      Contact {name} using your usual phone call or Telegram chat. You can add their
                      calling number in You, with their permission.
                    </Trans>
                  </Words>
                ) : (
                  <PrimaryButton label={t`Call ${name}`} onPress={() => void call(callingNumber)} />
                )}
                <SecondaryButton
                  label={settling ? t`Saving…` : t`${name} is fine, I know why`}
                  disabled={settling || asking}
                  onPress={onFine}
                />
                <SecondaryButton
                  label={t`Wait 2 hours`}
                  disabled={settling || asking}
                  onPress={onWait}
                />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** How this morning's ask to look in stands, in one line with their name. */
function askedLine(
  name: string,
  asked: { at: string; byName?: string; reply: "yes" | "no" | null },
): string {
  const time = asked.at;
  if (asked.reply === "yes") return t`${name} will look in.`;
  if (asked.reply === "no") return t`${name} can't today.`;
  const by = asked.byName;
  return by === undefined
    ? t`Asked at ${time}. Waiting for ${name}.`
    : t`${by} asked at ${time}. Waiting for ${name}.`;
}
