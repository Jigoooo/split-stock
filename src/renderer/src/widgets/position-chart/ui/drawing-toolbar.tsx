import { Button } from '@renderer/shared/ui';
import { Eraser, GripVertical, Minus, Square, Trash2, TrendingUp } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import type { DrawingToolKind } from '../model/drawing-types';

/**
 * backdrop-filter 는 macOS Electron 에서 별도 compositor 레이어 +
 * IOSurface 를 요구해 chart canvas 와 충돌하면 GPU 고갈을 유발. 완전 불투명
 * 배경으로 교체해 compositor 추가 비용을 없앤다.
 */
const TOOLBAR_STYLE: CSSProperties = {
  background: '#ffffff',
  border: '1px solid rgba(0, 0, 0, 0.08)',
  borderRadius: '0.6rem',
  padding: '0.4rem',
  boxShadow: '0 0.4rem 1.2rem rgba(15, 23, 42, 0.12)',
};

interface DrawingToolbarProps {
  activeTool: DrawingToolKind | null;
  disabled?: boolean;
  onRemoveAll: () => void;
  onRemoveLast: () => void;
  onStartDraw: (tool: DrawingToolKind) => void;
}

const TOOL_BUTTONS: Array<{
  icon: ReactElement;
  label: string;
  tool: DrawingToolKind;
}> = [
  { tool: 'TrendLine', label: '추세선', icon: <TrendingUp size={14} /> },
  { tool: 'HorizontalLine', label: '수평선', icon: <Minus size={14} /> },
  { tool: 'VerticalLine', label: '수직선', icon: <GripVertical size={14} /> },
  { tool: 'Rectangle', label: '박스', icon: <Square size={14} /> },
];

export const DrawingToolbar = ({
  activeTool,
  disabled = false,
  onRemoveAll,
  onRemoveLast,
  onStartDraw,
}: DrawingToolbarProps): ReactElement => {
  return (
    <div
      role="toolbar"
      aria-label="드로잉 도구"
      style={{
        ...TOOLBAR_STYLE,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 3,
      }}
    >
      {TOOL_BUTTONS.map((item) => (
        // 도구 선택은 chart 준비 전에도 허용 — startDraw 가 graceful 하게 처리한다.
        // disabled 로 막으면 data 로드 타이밍에 따라 버튼이 먹지 않는 증상이 생긴다.
        <Button
          key={item.tool}
          dense
          iconOnly
          active={activeTool === item.tool}
          aria-pressed={activeTool === item.tool}
          aria-label={item.label}
          title={item.label}
          iconLeading={item.icon}
          onClick={() => onStartDraw(item.tool)}
        >
          {item.label}
        </Button>
      ))}
      <div
        aria-hidden
        style={{
          height: 1,
          margin: '0.2rem 0',
          background: 'rgba(148, 163, 184, 0.4)',
        }}
      />
      <Button
        dense
        iconOnly
        disabled={disabled}
        aria-label="마지막 되돌리기"
        title="마지막 되돌리기"
        iconLeading={<Trash2 size={14} />}
        onClick={onRemoveLast}
      >
        마지막 되돌리기
      </Button>
      <Button
        dense
        iconOnly
        disabled={disabled}
        aria-label="전체 삭제"
        title="전체 삭제"
        iconLeading={<Eraser size={14} />}
        onClick={onRemoveAll}
      >
        전체 삭제
      </Button>
    </div>
  );
};
