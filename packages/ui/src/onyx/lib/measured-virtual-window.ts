/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
export interface MeasuredVirtualWindow {
  start: number;
  end: number;
  before: number;
  after: number;
}

/** A contiguous virtual window for a caller's known or measured row heights. */
export function calculateMeasuredVirtualWindow(
  heights: readonly number[], scrollTop: number, viewportHeight: number, overscan = 12,
): MeasuredVirtualWindow {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1]! + (Number.isFinite(height) ? Math.max(0, height) : 0));
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const bottom = top + (Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0);
  const extra = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;
  let first = 0;
  while (first < heights.length && offsets[first + 1]! <= top) first++;
  let last = first;
  while (last < heights.length && offsets[last]! < bottom) last++;
  const start = Math.max(0, first - extra);
  const end = Math.min(heights.length, last + extra);
  return { start, end, before: offsets[start]!, after: offsets[offsets.length - 1]! - offsets[end]! };
}
