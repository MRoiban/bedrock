/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
export interface RGB {
  r: number;
  g: number;
  b: number;
  a?: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
  a?: number | undefined;
}
const clamp = (v: number, max = 1) => Math.min(max, Math.max(0, v));
export function rgbToHsv({ r, g, b, a }: RGB): HSV {
  r = clamp(r, 255) / 255;
  g = clamp(g, 255) / 255;
  b = clamp(b, 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let h =
    delta === 0
      ? 0
      : max === r
        ? 60 * (((g - b) / delta) % 6)
        : max === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  h = (h + 360) % 360;
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
    ...(a === undefined ? {} : { a }),
  };
}
export function hsvToRgb({ h, s, v, a }: HSV): RGB {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  v = clamp(v);
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    ...(a === undefined ? {} : { a: clamp(a) }),
  };
}
export function hexToRgb(hex: string): RGB | null {
  let text = hex.replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(text))
    return null;
  if (text.length <= 4)
    text = text
      .split('')
      .map((c) => c + c)
      .join('');
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
    ...(text.length === 8 ? { a: parseInt(text.slice(6, 8), 16) / 255 } : {}),
  };
}
export function rgbToHex(
  { r, g, b, a }: RGB,
  includeAlpha = a !== undefined,
): string {
  const channel = (n: number) =>
    Math.round(clamp(n, 255)).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}${includeAlpha ? channel((a ?? 1) * 255) : ''}`.toUpperCase();
}
export const hexToHsv = (hex: string): HSV | null => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
};
export const hsvToHex = (hsv: HSV, includeAlpha = hsv.a !== undefined) =>
  rgbToHex(hsvToRgb(hsv), includeAlpha);
