import { createElement, type Dispatch, type ReactNode, type SetStateAction, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { Text } from "./scaled-text.tsx";

const display = vi.hoisted(() => ({
  dimensions: { width: 393, height: 852, scale: 3, fontScale: 1 },
  listeners: new Set<() => void>(),
  nextInstance: 0,
}));
vi.mock("react-native", async () => {
  const React = await import("react");
  return {
    Text: (props: { children?: ReactNode }) => {
      const [instance] = React.useState(() => ++display.nextInstance);
      return React.createElement("native-text", { ...props, instance }, props.children);
    },
    StyleSheet: { flatten: (style: unknown) => Object.assign({}, ...[style].flat(5)) },
    useWindowDimensions: () =>
      React.useSyncExternalStore(
        (listener) => {
          display.listeners.add(listener);
          return () => display.listeners.delete(listener);
        },
        () => display.dimensions,
      ),
  };
});

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  display.listeners.clear();
});

it("remeasures native text after live size changes without losing the screen's unsaved draft", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let edit!: Dispatch<SetStateAction<string>>;
  function DraftScreen() {
    const [draft, setDraft] = useState("A synthetic question");
    edit = setDraft;
    return createElement(Text, { style: { fontSize: 36 }, maxFontSizeMultiplier: 1.5 }, draft);
  }
  await act(async () => {
    renderer = create(createElement(DraftScreen));
  });
  await act(async () => edit("An unsaved synthetic edit"));
  const before = renderer?.root.find((node) => typeof node.props.instance === "number");
  let instance = before?.props.instance;
  for (const fontScale of [3.12, 1, 2]) {
    await act(async () => {
      display.dimensions = { ...display.dimensions, fontScale };
      for (const listener of display.listeners) listener();
    });
    const text = renderer?.root.find((node) => typeof node.props.instance === "number");
    expect(text?.props.instance).not.toBe(instance);
    expect(text?.props.children).toBe("An unsaved synthetic edit");
    expect(text?.props.maxFontSizeMultiplier).toBe(1.5);
    instance = text?.props.instance;
  }
});
