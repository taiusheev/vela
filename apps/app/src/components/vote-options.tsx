import { Trans, useLingui } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { VOTE_OPTIONS } from "../data/ask.ts";
import { hitSlop, space } from "../theme/tokens.ts";
import { TextField, Words } from "./ui.tsx";

/** One option as it is typed; its id keeps the field it was typed in when another is removed. */
export interface VoteOption {
  id: number;
  text: string;
}

let made = 0;

function option(): VoteOption {
  made += 1;
  return { id: made, text: "" };
}

/** A vote starts with the two options it cannot do without. */
export function freshVoteOptions(): VoteOption[] {
  return Array.from({ length: VOTE_OPTIONS.fewest }, option);
}

/**
 * A vote's options (ComposeAsk `vote_options`): two to seven short answers she taps one of. Blank
 * ones are left out when the ask is sent, and the two first cannot be removed.
 */
export function VoteOptions({
  options,
  onChange,
}: {
  options: readonly VoteOption[];
  onChange: (next: VoteOption[]) => void;
}) {
  const { t } = useLingui();
  return (
    <View style={{ gap: space.m }}>
      {options.map((entry, index) => {
        const number = index + 1;
        return (
          <View key={entry.id} style={{ gap: space.s }}>
            <TextField
              value={entry.text}
              onChangeText={(text) =>
                onChange(
                  options.map((other) => (other.id === entry.id ? { ...other, text } : other)),
                )
              }
              placeholder={t`Option ${number}`}
              maxLength={VOTE_OPTIONS.longest}
            />
            {index < VOTE_OPTIONS.fewest ? null : (
              <Pressable
                accessibilityRole="button"
                hitSlop={hitSlop}
                onPress={() => onChange(options.filter((other) => other.id !== entry.id))}
                style={{ alignSelf: "flex-end" }}
              >
                <Words variant="button" tone="action">
                  <Trans>Remove</Trans>
                </Words>
              </Pressable>
            )}
          </View>
        );
      })}
      <Words variant="caption" tone="ink3">
        <Trans>Short answers she can tap, from two to seven.</Trans>
      </Words>
      {options.length >= VOTE_OPTIONS.most ? null : (
        <Pressable
          accessibilityRole="button"
          hitSlop={hitSlop}
          onPress={() => onChange([...options, option()])}
          style={{ alignSelf: "flex-start" }}
        >
          <Words variant="button" tone="action">
            <Trans>Add an option</Trans>
          </Words>
        </Pressable>
      )}
    </View>
  );
}
