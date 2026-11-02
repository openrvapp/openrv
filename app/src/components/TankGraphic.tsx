import Svg, { ClipPath, Defs, Rect } from 'react-native-svg';
import { useTheme } from 'react-native-paper';

interface Props {
  /** Fill, 0-1; undefined draws an empty tank. */
  fraction: number | undefined;
  shape: 'propane' | 'liquid';
  color?: string;
  width?: number;
  height?: number;
}

const OUTLINE = 2;

/**
 * A tank filled from the bottom (drawn like the MAUI app's): a propane cylinder (domed body on a
 * foot ring, valve inside its handle collar) or a plain rounded liquid tank.
 */
export function TankGraphic({ fraction, shape, color, width = 56, height = 72 }: Props) {
  const theme = useTheme();
  const fill = color ?? theme.colors.primary;
  const value = Math.max(0, Math.min(1, fraction ?? 0));
  const label = fraction === undefined ? 'No reading' : `${Math.round(value * 100)} percent full`;

  if (shape === 'liquid') {
    const w = Math.min(width, height * 0.8) - OUTLINE;
    const body = { x: (width - w) / 2, y: OUTLINE / 2, w, h: height - OUTLINE, r: w * 0.18 };
    return (
      <Svg width={width} height={height} accessibilityRole="image" accessibilityLabel={label}>
        <Body body={body} value={value} fill={fill} track={theme.colors.surfaceVariant} id="liquid" />
      </Svg>
    );
  }

  const w = Math.min(width, height * 0.66) - OUTLINE;
  const centre = width / 2;
  const collarH = height * 0.2;
  const footH = height * 0.05;
  const overlap = w * 0.03; // tucks the collar and foot under the body's curved ends
  const body = { x: centre - w / 2, y: collarH, w, h: height - collarH - footH, r: w * 0.34 };
  const wheelTop = collarH * 0.3;
  const wheelH = collarH * 0.24;

  return (
    <Svg width={width} height={height} accessibilityRole="image" accessibilityLabel={label}>
      {/* Foot ring */}
      <Rect x={centre - w * 0.3} y={body.y + body.h - overlap} width={w * 0.6} height={footH + overlap} fill={fill} />
      {/* Valve: a stem with a handwheel across the top */}
      <Rect x={centre - w * 0.05} y={wheelTop} width={w * 0.1} height={body.y + overlap - wheelTop} fill={fill} />
      <Rect x={centre - w * 0.15} y={wheelTop} width={w * 0.3} height={wheelH} rx={wheelH / 2} fill={fill} />
      {/* Handle collar */}
      <Rect
        x={centre - w * 0.28}
        y={OUTLINE / 2}
        width={w * 0.56}
        height={collarH + overlap - OUTLINE / 2}
        rx={3}
        fill="none"
        stroke={fill}
        strokeWidth={OUTLINE}
      />
      <Body body={body} value={value} fill={fill} track={theme.colors.surfaceVariant} id="propane" />
    </Svg>
  );
}

/** An outlined rounded body, filled from the bottom to `value`. */
function Body({
  body,
  value,
  fill,
  track,
  id,
}: {
  body: { x: number; y: number; w: number; h: number; r: number };
  value: number;
  fill: string;
  track: string;
  id: string;
}) {
  const level = body.h * value;
  return (
    <>
      <Defs>
        <ClipPath id={id}>
          <Rect x={body.x} y={body.y} width={body.w} height={body.h} rx={body.r} />
        </ClipPath>
      </Defs>
      <Rect x={body.x} y={body.y} width={body.w} height={body.h} rx={body.r} fill={track} />
      <Rect x={body.x} y={body.y + body.h - level} width={body.w} height={level} fill={fill} clipPath={`url(#${id})`} />
      <Rect
        x={body.x}
        y={body.y}
        width={body.w}
        height={body.h}
        rx={body.r}
        fill="none"
        stroke={fill}
        strokeWidth={OUTLINE}
      />
    </>
  );
}
