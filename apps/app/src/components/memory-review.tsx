import type { FamilyMemoryKind } from "@vela/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { MemoryReviewController, ReviewMemory } from "../data/memory-review.ts";
import { lightPalette, radius, space, type } from "../theme/tokens.ts";

/** Copy is injected so this reusable view does not bypass the app's locale layer. */
export interface MemoryReviewCopy {
  you: string;
  title: string;
  introduction: string;
  toReview: string;
  kept: string;
  categories: Record<FamilyMemoryKind, string>;
  source: string;
  keep: string;
  dismiss: string;
  remove: string;
  back: string;
  keepTitle: string;
  keepExplanation: string;
  keepConfirm: string;
  removeTitle: string;
  removeExplanation: string;
  removeConfirm: string;
  parentDecides(name: string): string;
  emptyReview: string;
  emptyKept: string;
  loading: string;
  readFailed: string;
  actionFailed: string;
  retry: string;
  pending: string;
  notices: Record<"kept" | "dismissed" | "removed" | "unavailable", string>;
}
const ink = lightPalette;
const body = { ...type.body, fontSize: 22, lineHeight: 32, color: ink.ink2 };

function ReviewButton({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 64,
        borderRadius: radius.button + 4,
        borderWidth: 1,
        borderColor: primary ? ink.action : ink.control,
        backgroundColor: primary ? ink.action : ink.surface,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        padding: space.l,
        justifyContent: "center",
        alignItems: "center",
      })}
    >
      <Text
        style={[
          type.button,
          {
            fontSize: 20,
            lineHeight: 28,
            color: primary ? ink.onAction : ink.action,
            textAlign: "center",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Parent-facing review, deliberately light and generous; no words edited or saved optimistically. */
export function MemoryReview({
  controller,
  copy,
  onScreenChange,
}: {
  controller: MemoryReviewController;
  copy: MemoryReviewCopy;
  onScreenChange?(event: { pane: string; notice: string | null }): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const [tab, setTab] = useState<"suggested" | "kept">("suggested");
  useEffect(() => {
    onScreenChange?.({ pane: state.pane, notice: state.notice });
  }, [state.pane, state.notice, onScreenChange]);
  const selected = controller.selected();
  const busy = state.pending !== null;
  const error = state.actionFailed ? (
    <View accessibilityRole="alert" style={{ gap: space.m }}>
      <Text style={body}>{copy.actionFailed}</Text>
    </View>
  ) : null;

  if (selected && state.pane !== "list") {
    const source = state.pane === "source";
    const keeping = state.pane === "keep";
    return (
      <View style={{ gap: space.xl }}>
        <Text accessibilityRole="header" style={[type.title, { color: ink.ink }]}>
          {source ? copy.source : keeping ? copy.keepTitle : copy.removeTitle}
        </Text>
        {source ? (
          <>
            <Text style={body}>{selected.sourceQuestion}</Text>
            <Text selectable style={[type.voice, { color: ink.ink }]}>
              {selected.sourceAnswer}
            </Text>
            <Text style={body}>
              {selected.authorId === controller.viewerId ? copy.you : selected.authorName} ·{" "}
              {selected.dateLabel}
            </Text>
          </>
        ) : (
          <>
            <Quote item={selected} />
            <Text style={body}>{keeping ? copy.keepExplanation : copy.removeExplanation}</Text>
            {error}
            <ReviewButton
              primary
              label={busy ? copy.pending : keeping ? copy.keepConfirm : copy.removeConfirm}
              disabled={busy}
              onPress={() => {
                void controller.act(keeping ? "keep" : "remove", selected.id);
              }}
            />
          </>
        )}
        <ReviewButton label={copy.back} disabled={busy} onPress={() => controller.cancel()} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.m }}>
        <Text accessibilityRole="header" style={[type.display, { color: ink.ink }]}>
          {copy.title}
        </Text>
        <Text style={body}>{copy.introduction}</Text>
      </View>
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", gap: space.s, flexWrap: "wrap" }}
      >
        {(["suggested", "kept"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value, disabled: busy }}
            disabled={busy}
            onPress={() => setTab(value)}
            style={{
              flexGrow: 1,
              minHeight: 64,
              borderRadius: radius.button + 4,
              backgroundColor: tab === value ? ink.actionSoft : ink.bg,
              borderWidth: 1,
              borderColor: tab === value ? ink.action : ink.control,
              alignItems: "center",
              justifyContent: "center",
              padding: space.m,
            }}
          >
            <Text style={[type.button, { color: ink.action, fontSize: 20, lineHeight: 28 }]}>
              {value === "suggested" ? copy.toReview : copy.kept}
            </Text>
          </Pressable>
        ))}
      </View>
      {state.notice ? (
        <Text accessibilityLiveRegion="polite" style={body}>
          {copy.notices[state.notice]}
        </Text>
      ) : null}
      {state.phase === "loading" ? (
        <View accessibilityState={{ busy: true }}>
          <Text accessibilityLiveRegion="polite" style={body}>
            {copy.loading}
          </Text>
        </View>
      ) : state.phase === "read_error" ? (
        <View style={{ gap: space.l }}>
          <Text accessibilityRole="alert" style={body}>
            {copy.readFailed}
          </Text>
          <ReviewButton
            label={copy.retry}
            onPress={() => {
              void controller.load();
            }}
          />
        </View>
      ) : (
        <>
          {state.items.filter((item) => item.state === tab).length === 0 ? (
            <Text style={body}>{tab === "suggested" ? copy.emptyReview : copy.emptyKept}</Text>
          ) : null}
          {error}
          {state.items
            .filter((item) => item.state === tab)
            .map((item) => (
              <View
                key={item.id}
                style={{
                  borderTopWidth: 1,
                  borderColor: ink.rule,
                  paddingVertical: space.xl,
                  gap: space.l,
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={[type.heading, { color: ink.ink2, fontSize: 22, lineHeight: 30 }]}
                >
                  {copy.categories[item.kind]}
                </Text>
                <Quote item={item} />
                <Text style={body}>
                  {item.authorId === controller.viewerId ? copy.you : item.authorName} ·{" "}
                  {item.dateLabel}
                </Text>
                {item.state === "suggested" ? <Text style={body}>{item.expiryLabel}</Text> : null}
                <ReviewButton
                  label={copy.source}
                  disabled={busy}
                  onPress={() => controller.open(item.id, "source")}
                />
                {item.authorId === controller.viewerId ? (
                  item.state === "suggested" ? (
                    <>
                      <ReviewButton
                        primary
                        label={copy.keep}
                        disabled={busy}
                        onPress={() => controller.open(item.id, "keep")}
                      />
                      <ReviewButton
                        label={state.pending === "dismiss" ? copy.pending : copy.dismiss}
                        disabled={busy}
                        onPress={() => {
                          void controller.act("dismiss", item.id);
                        }}
                      />
                    </>
                  ) : (
                    <ReviewButton
                      label={copy.remove}
                      disabled={busy}
                      onPress={() => controller.open(item.id, "remove")}
                    />
                  )
                ) : (
                  <Text style={body}>{copy.parentDecides(item.authorName)}</Text>
                )}
              </View>
            ))}
        </>
      )}
    </View>
  );
}

function Quote({ item }: { item: ReviewMemory }) {
  return (
    <Text selectable style={[type.voice, { color: ink.ink }]}>
      {item.quote}
    </Text>
  );
}
