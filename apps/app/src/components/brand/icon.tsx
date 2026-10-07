import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/** Drawn on one 24-unit grid. Decorative; the enclosing control provides its label. */
const drawings = {
  today: "M9 3h6a5 5 0 0 1 5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a5 5 0 0 1 5-5Z M12 3v18M4 10h16",
  exchanges:
    "M5 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-5l-5 4v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z M6 8h10M6 12h7",
  sunday: "M3 5c3-1 6-1 9 2 3-3 6-3 9-2v14c-3-1-6-1-9 2-3-3-6-3-9-2V5Zm9 2v14",
  you: "M12 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8ZM4 21v-2a8 8 0 0 1 16 0v2",
  ask: "M4 20h4L20 8a3 3 0 0 0-4-4L4 16v4ZM14 6l4 4",
  reply: "M10 5 3 12l7 7M3 12h10a8 8 0 0 1 8 8",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m9 5 7 7-7 7",
  mic: "M9 5a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V5Zm-3 6v2a6 6 0 0 0 12 0v-2m-6 8v3m-3 0h6",
  photo:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 17l6-6 5 5 4-4 3 3M16 8h.01",
  play: "m9 4 12 8-12 8V4Z",
  call: "m7 3-4 4c1 8 6 13 14 14l4-4-5-4-3 3c-3-1-4-2-5-5l3-3-4-5Z",
  nearby: "M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13ZM12 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z",
  time: "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20Zm0 4v6l4 3",
  check: "m4 12 5 5L20 6",
  close: "m5 5 14 14M19 5 5 19",
  pause: "M8 4v16M16 4v16",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  privacy: "M6 10h12v11H6V10Zm3 0V5a3 3 0 0 1 6 0v5m-3 4v3",
  heart: "M12 21 3 12a6 6 0 0 1 9-8 6 6 0 0 1 9 8l-9 9Z",
  calendar: "M4 5h16v16H4V5Zm4-3v6m8-6v6M4 10h16m-12 5h2m4 0h2",
  mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
} as const;

export type BrandIconName = keyof typeof drawings;

export function BrandIcon({
  name,
  color,
  size = 24,
  strokeWidth = 1.7,
}: {
  name: BrandIconName;
  color: ColorValue;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={drawings[name]}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
