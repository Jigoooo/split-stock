import { describe, expect, it } from 'vitest';

function clampWindowSize(value: number, minValue: number | undefined, maxValue: number): number {
  return Math.min(Math.max(value, minValue ?? 0), maxValue);
}

function constrainWindowBounds(input: {
  area: { x: number; y: number; width: number; height: number };
  current: { x: number; y: number; width: number; height: number };
  minWidth: number | undefined;
  minHeight: number | undefined;
  maxWidth: number;
  maxHeight: number;
  clampPosition: boolean;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = clampWindowSize(input.current.width, input.minWidth, input.maxWidth);
  const height = clampWindowSize(input.current.height, input.minHeight, input.maxHeight);

  if (!input.clampPosition) {
    return {
      x: input.current.x,
      y: input.current.y,
      width,
      height,
    };
  }

  const maxX = input.area.x + input.area.width - width;
  const maxY = input.area.y + input.area.height - height;
  return {
    x: Math.min(Math.max(input.current.x, input.area.x), maxX),
    y: Math.min(Math.max(input.current.y, input.area.y), maxY),
    width,
    height,
  };
}

describe('constrainWindowBounds', () => {
  it('move 중에는 위치를 clamp하지 않고 크기만 줄인다', () => {
    expect(
      constrainWindowBounds({
        area: { x: 1920, y: 0, width: 1280, height: 720 },
        current: { x: 1700, y: 10, width: 1760, height: 1100 },
        minWidth: 720,
        minHeight: 540,
        maxWidth: 1280,
        maxHeight: 720,
        clampPosition: false,
      }),
    ).toEqual({
      x: 1700,
      y: 10,
      width: 1280,
      height: 720,
    });
  });

  it('정리 단계에서는 위치까지 작업영역 안으로 clamp한다', () => {
    expect(
      constrainWindowBounds({
        area: { x: 1920, y: 0, width: 1280, height: 720 },
        current: { x: 1700, y: 10, width: 1760, height: 1100 },
        minWidth: 720,
        minHeight: 540,
        maxWidth: 1280,
        maxHeight: 720,
        clampPosition: true,
      }),
    ).toEqual({
      x: 1920,
      y: 0,
      width: 1280,
      height: 720,
    });
  });
});
