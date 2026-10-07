import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { usePalette } from "../../theme/theme.tsx";

export type SceneKind = "table" | "letter" | "book" | "window" | "offline";

/** Native vector illustrations: one architectural grammar, quiet colour and no external assets. */
export function FamilyScene({ kind = "table", width = 216 }: { kind?: SceneKind; width?: number }) {
  const p = usePalette();
  const window = (
    <G>
      <Path
        d="M108 27h28a25 25 0 0 1 25 25v58a10 10 0 0 1-10 10H93a10 10 0 0 1-10-10V52a25 25 0 0 1 25-25Z"
        fill={kind === "offline" ? p.surface2 : p.lightSoft}
        stroke={p.ink}
        strokeWidth={3}
      />
      <Path d="M122 27v93M83 66h78" stroke={p.ink} strokeWidth={2.5} />
      {kind === "offline" ? null : <Rect x={126} y={70} width={30} height={43} fill={p.light} />}
    </G>
  );
  const art =
    kind === "letter" ? (
      <G>
        <Path d="m49 81 73-48 72 48v65H49V81Z" fill={p.lightSoft} />
        <Rect
          x={69}
          y={37}
          width={104}
          height={95}
          rx={5}
          fill={p.surface}
          stroke={p.ink}
          strokeWidth={2.5}
        />
        <Path
          d="M87 59h63M87 75h56M87 91h67"
          stroke={p.ink2}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <Path d="m49 81 73 49 72-49v65H49V81Z" fill={p.light} stroke={p.ink} strokeWidth={2.5} />
        <Path d="m49 146 54-38m91 38-54-38" stroke={p.ink} strokeWidth={2.5} />
        <Path
          d="M184 43c7-13 7-23 4-31-11 7-15 17-4 31Zm-1 2c-12-2-20-9-23-18 15-3 23 4 23 18Z"
          fill={p.action}
        />
      </G>
    ) : kind === "book" ? (
      <G>
        <Path
          d="M45 39c25-7 52-3 77 13 25-16 52-20 77-13v99c-25-7-52-3-77 13-25-16-52-20-77-13V39Z"
          fill={p.lightSoft}
          stroke={p.ink}
          strokeWidth={3}
        />
        <Path
          d="M122 52v99M61 70h42M61 86h35M61 102h40M142 116h36"
          stroke={p.ink2}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <G transform="translate(49 40) scale(.68)">{window}</G>
        <Path d="M105 152h34" stroke={p.action} strokeWidth={5} strokeLinecap="round" />
      </G>
    ) : (
      <G>
        {window}
        <Path
          d="M34 138h177M55 141v25m134-25v25"
          stroke={p.ink}
          strokeWidth={3}
          strokeLinecap="round"
        />
        {kind === "window" || kind === "offline" ? (
          <G>
            <Rect x={91} y={135} width={42} height={24} rx={4} fill={p.action} />
            <Path
              d="M111 135c-2-19 0-35 15-46m-14 29c-18-3-25-13-23-24 18 1 25 11 23 24m7-15c16-4 22-13 20-23-14 1-22 10-20 23"
              fill={p.action}
              stroke={p.action}
              strokeWidth={2}
            />
          </G>
        ) : (
          <G>
            <Path d="M52 106h38v27H61a9 9 0 0 1-9-9v-18Z" fill={p.action} />
            <Path d="M90 110h5c12 0 12 18 0 18h-5" stroke={p.action} strokeWidth={4} fill="none" />
            <Path
              d="M157 106h33v27h-24a9 9 0 0 1-9-9v-18Z"
              fill={p.light}
              stroke={p.ink}
              strokeWidth={2}
            />
            <Path d="M190 110h4c12 0 12 18 0 18h-4" stroke={p.ink} strokeWidth={2} fill="none" />
            <Path
              d="m105 126 27-12 18 19-28 7-17-14Z"
              fill={p.surface}
              stroke={p.ink2}
              strokeWidth={1.5}
            />
          </G>
        )}
        {kind === "offline" ? <Circle cx={188} cy={55} r={7} fill={p.ink3} /> : null}
      </G>
    );
  return (
    <Svg width={width} height={(width * 180) / 244} viewBox="0 0 244 180" accessible={false}>
      {art}
    </Svg>
  );
}
