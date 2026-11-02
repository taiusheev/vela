import { type KeyboardEvent, useEffect, useSyncExternalStore } from "react";
import { Platform, Pressable, View } from "react-native";
import type { MemorySharingController } from "../data/memory-sharing.ts";
import { lightPalette as ink, radius, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";

/** Caller supplies reviewed locale copy; the current preview is English-only, not acceptance UI. */
export interface MemorySharingCopy {
  title: string;
  introduction: string;
  private: string;
  sharedWith: string;
  confirmAudience: string;
  choose: string;
  review: string;
  confirmTitle: string;
  confirm: string;
  back: string;
  stop: string;
  stopExplanation: string;
  noPeople: string;
  loading: string;
  unavailable: string;
  readError: string;
  actionError: string;
  expired: string;
  retry: string;
  pending: string;
  updated: string;
}
const body = { ...type.body, fontSize: 22, lineHeight: 32, color: ink.ink2 };
function Button({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
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
        padding: space.l,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={[
          type.button,
          {
            fontSize: 20,
            lineHeight: 28,
            textAlign: "center",
            color: primary ? ink.onAction : ink.action,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MemorySharing({
  controller,
  copy,
  onScreenChange,
}: {
  controller: MemorySharingController;
  copy: MemorySharingCopy;
  onScreenChange?(pane: "confirm" | "people" | "loading" | "read_error" | "unavailable"): void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  const pane = state.phase === "ready" ? (state.preview ? "confirm" : "people") : state.phase;
  useEffect(() => {
    onScreenChange?.(pane);
  }, [pane, onScreenChange]);
  const busy = state.pending !== null;
  const view = state.view;
  const failure = state.error === "expired" ? copy.expired : state.error ? copy.actionError : null;
  if (state.phase !== "ready" || !view)
    return (
      <View style={{ gap: space.l }}>
        <Text accessibilityRole="header" style={[type.title, { color: ink.ink }]}>
          {copy.title}
        </Text>
        <Text accessibilityLiveRegion="polite" style={body}>
          {state.phase === "loading" || busy
            ? copy.loading
            : state.phase === "unavailable"
              ? copy.unavailable
              : copy.readError}
        </Text>
        {failure ? (
          <Text accessibilityRole="alert" style={body}>
            {failure}
          </Text>
        ) : null}
        {controller.canStop() ? (
          <>
            <Text style={body}>{copy.stopExplanation}</Text>
            <Button
              label={copy.stop}
              disabled={busy}
              onPress={() => {
                void controller.stop();
              }}
            />
          </>
        ) : null}
        {state.phase !== "loading" ? (
          <Button
            label={copy.retry}
            disabled={busy}
            onPress={() => {
              void controller.load();
            }}
          />
        ) : null}
      </View>
    );
  const shared = view.recipients.filter((r) => r.shared);
  return (
    <View style={{ gap: space.xl }}>
      <Text accessibilityRole="header" style={[type.title, { color: ink.ink }]}>
        {state.preview ? copy.confirmTitle : copy.title}
      </Text>
      <Text style={body}>{state.preview ? state.preview.explanation : copy.introduction}</Text>
      <Text selectable style={[type.voice, { color: ink.ink }]}>
        {view.quote}
      </Text>
      {state.preview ? (
        <View style={{ gap: space.m }}>
          <Text style={body}>{copy.confirmAudience}</Text>
          {state.preview.recipients.map((r) => (
            <Text key={r.member_id} style={[type.heading, { color: ink.ink }]}>
              {r.display_name}
            </Text>
          ))}
        </View>
      ) : (
        <>
          <View style={{ gap: space.s }}>
            <Text accessibilityLiveRegion="polite" style={body}>
              {shared.length === 0 ? copy.private : copy.sharedWith}
            </Text>
            {shared.map((r) => (
              <Text key={r.member_id} style={[type.heading, { color: ink.ink }]}>
                {r.display_name}
              </Text>
            ))}
          </View>
          <View style={{ gap: space.s }}>
            <Text accessibilityRole="header" style={[type.heading, { color: ink.ink }]}>
              {copy.choose}
            </Text>
            {view.recipients.length === 0 ? <Text style={body}>{copy.noPeople}</Text> : null}
            {view.recipients.map((r) => {
              const checked = state.selected.includes(r.member_id);
              return (
                <Pressable
                  key={r.member_id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={r.display_name}
                  accessibilityState={{ checked, disabled: busy }}
                  aria-checked={checked}
                  {...(Platform.OS === "web"
                    ? {
                        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                          if (event.key === " " && !busy) {
                            event.preventDefault();
                            if (!event.repeat) controller.toggle(r.member_id);
                          }
                        },
                      }
                    : {})}
                  disabled={busy}
                  onPress={() => controller.toggle(r.member_id)}
                  style={({ pressed }) => ({
                    minHeight: 64,
                    paddingVertical: space.l,
                    paddingHorizontal: space.m,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.m,
                    borderBottomWidth: 1,
                    borderColor: ink.rule,
                    backgroundColor: checked ? ink.actionSoft : pressed ? ink.surface : ink.bg,
                  })}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderWidth: 2,
                      borderColor: checked ? ink.action : ink.control,
                      borderRadius: 6,
                      backgroundColor: checked ? ink.action : ink.surface,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {checked ? <BrandIcon name="check" color={ink.onAction} size={18} /> : null}
                  </View>
                  <Text style={[body, { flex: 1, color: ink.ink }]}>{r.display_name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      {failure ? (
        <Text accessibilityRole="alert" style={body}>
          {failure}
        </Text>
      ) : null}
      {state.notice ? (
        <Text accessibilityLiveRegion="polite" style={body}>
          {copy.updated}
        </Text>
      ) : null}
      {state.preview ? (
        <>
          <Button
            primary
            label={busy ? copy.pending : copy.confirm}
            disabled={busy}
            onPress={() => {
              void controller.confirm();
            }}
          />
          <Button label={copy.back} disabled={busy} onPress={() => controller.cancel()} />
        </>
      ) : (
        <>
          <Button
            primary
            label={busy ? copy.pending : copy.review}
            disabled={busy || state.selected.length === 0}
            onPress={() => {
              void controller.prepare();
            }}
          />
          {shared.length > 0 ? (
            <View style={{ gap: space.m }}>
              <Text style={body}>{copy.stopExplanation}</Text>
              <Button
                label={busy ? copy.pending : copy.stop}
                disabled={busy}
                onPress={() => {
                  void controller.stop();
                }}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
