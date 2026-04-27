import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@renderer/shared/ui';
import type { AppEnv, BrokerId } from '@shared/contracts';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';

export interface AccountRow {
  id: number;
  env: AppEnv;
  broker: BrokerId;
  accountNo8: string;
  /** 상품코드 — 라벨 충돌 방지(같은 broker/env/마지막4자리 조합)로 마지막2 표기 시 사용. */
  accountProdCd?: string | null;
  displayName: string | null;
  isActive: boolean;
}

interface Props {
  accounts: AccountRow[];
  switching: boolean;
  deletePending: boolean;
  renamePending: boolean;
  reorderPending: boolean;
  hideAddAccount: boolean;
  onPick: (id: number) => void;
  onDelete: (row: AccountRow) => void;
  onRename: (row: AccountRow) => void;
  onReorder: (orderedIds: number[]) => void;
  onAddAccount: () => void;
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
const verticalAxisModifiers = [restrictToVerticalAxis];

/**
 * 계좌 셀렉터 드롭다운 listbox.
 * - 각 계좌 한 줄: 환경 dot + 라벨 + (현재) 표시 + 휴지통.
 * - 하단: "+ 계좌 추가" 버튼 (hideAddAccount=true 면 숨김).
 */
export const AccountSelectorList = ({
  accounts,
  switching,
  deletePending,
  renamePending,
  reorderPending,
  hideAddAccount,
  onPick,
  onDelete,
  onRename,
  onReorder,
  onAddAccount,
}: Props): ReactElement => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = accounts.findIndex((a) => a.id === active.id);
    const newIndex = accounts.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(accounts, oldIndex, newIndex);
    onReorder(reordered.map((a) => a.id));
  };

  const ids = accounts.map((a) => a.id);

  return (
    <div
      role="listbox"
      aria-label="계좌 목록"
      className="panel"
      style={{
        position: 'absolute',
        top: 'calc(100% + 0.4rem)',
        left: 0,
        zIndex: 200,
        minWidth: '20rem',
        padding: '0.4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.25)',
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={verticalAxisModifiers}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {accounts.map((a) => (
            <SortableAccountItem
              key={a.id}
              account={a}
              switching={switching}
              deletePending={deletePending}
              renamePending={renamePending}
              reorderPending={reorderPending}
              onPick={onPick}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </SortableContext>
      </DndContext>
      {hideAddAccount ? null : (
        <>
          <div aria-hidden style={{ height: 1, background: 'var(--border)', margin: '0.3rem 0' }} />
          <Button type="button" onClick={onAddAccount} dense variant="primary">
            + 계좌 추가
          </Button>
        </>
      )}
    </div>
  );
};

interface SortableAccountItemProps {
  account: AccountRow;
  switching: boolean;
  deletePending: boolean;
  renamePending: boolean;
  reorderPending: boolean;
  onPick: (id: number) => void;
  onDelete: (row: AccountRow) => void;
  onRename: (row: AccountRow) => void;
}

const SortableAccountItem = ({
  account: a,
  switching,
  deletePending,
  renamePending,
  reorderPending,
  onPick,
  onDelete,
  onRename,
}: SortableAccountItemProps): ReactElement => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: a.id,
  });
  // 활성 계좌 행 — tint 배경과 현재 배지로 한눈에 식별. 색상은 환경(PROD=빨강/MOCK=accent)
  // 으로 구분해 사고 위험까지 함께 전달.
  const activeAccentColor = a.env === 'PROD' ? 'var(--up)' : 'var(--accent)';
  const activeBg = a.env === 'PROD' ? 'var(--up-soft)' : 'var(--accent-tint-12)';
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.3rem 0.35rem 0.3rem 0.2rem',
    borderRadius: 4,
    background: a.isActive ? activeBg : undefined,
  };
  return (
    <div ref={setNodeRef} className="account-selector__item" style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={reorderPending}
        aria-label={`${formatAccountLabel(a)} 순서 변경`}
        title="드래그로 순서 변경"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'grab',
          color: 'var(--fg-2, #888)',
          touchAction: 'none',
        }}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        onClick={() => onPick(a.id)}
        disabled={switching || a.isActive}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.15rem 0',
          background: 'transparent',
          border: 'none',
          cursor: a.isActive ? 'default' : 'pointer',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          fontWeight: a.isActive ? 600 : 400,
        }}
      >
        <EnvDot env={a.env} />
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {formatAccountLabel(a)}
        </span>
        {a.isActive ? (
          <span
            title="현재 활성 계좌"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.1rem 0.45rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#fff',
              background: activeAccentColor,
              borderRadius: '0.25rem',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            현재
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => onRename(a)}
        disabled={renamePending}
        aria-label={`${formatAccountLabel(a)} 별칭 편집`}
        title="별칭 편집"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--fg-2, #888)',
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        onClick={() => onDelete(a)}
        disabled={deletePending}
        aria-label={`${formatAccountLabel(a)} 계좌 삭제`}
        title="계좌 삭제"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--fg-2, #888)',
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

export function formatAccountLabel(a: AccountRow): string {
  const tail = a.accountNo8.slice(-4);
  // accountProdCd 가 있을 때만 뒤에 -CD 를 덧붙여 같은 broker/env 의 다중 계좌 구분(예: -01 vs -22).
  // 미존재(레거시 데이터) 시 기존 라벨 그대로 — 회귀 위험 없음.
  const prodSuffix = a.accountProdCd ? `-${a.accountProdCd}` : '';
  const name = a.displayName?.trim();
  if (name && name.length > 0) return `${name} · ${a.env} ${tail}${prodSuffix}`;
  return `[${a.broker}] ${a.env} · ${tail}${prodSuffix}`;
}

export const EnvDot = ({ env }: { env: AppEnv }): ReactElement => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: env === 'PROD' ? 'var(--danger, #d4453a)' : 'var(--accent, #5b8def)',
    }}
  />
);
