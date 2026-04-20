import type { WatchOrder } from '@renderer/entities/watch-order';
import type { WatchOrderFormPrefill } from '@renderer/features/add-watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import { type CSSProperties, type ReactElement, useEffectEvent, useState } from 'react';

export interface WatchListProps {
  orders: WatchOrder[];
  isPending: boolean;
  error: { message: string } | null;
  /** 우클릭 메뉴에서 일부 액션 활성 여부 (히스토리 탭 등에서는 모두 비활성). */
  allowMutations: boolean;
  /** allowMutations=true 일 때 행 수정 버튼 클릭 시 호출. */
  onEditOrder?: (prefill: WatchOrderFormPrefill) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  ids: number[];
}

/**
 * 자동감시 행 리스트 + 다중 선택 + 우클릭 컨텍스트 메뉴.
 *
 * 액션:
 *   - 시작: 현재 라우터에 start 가 없어 비활성 (Wave 5 추가 예정)
 *   - 중지: 선택된 WATCHING 항목 cancel
 *   - 삭제: cancel 과 동일 의미 (FE 에서는 cancel 만 가능)
 */
export const WatchList = (props: WatchListProps): ReactElement => {
  const { allowMutations, error, isPending, onEditOrder, orders } = props;
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<ContextMenu | null>(null);

  const cancelMutation = trpc.watch.cancel.useMutation();

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onContextMenu = useEffectEvent((e: React.MouseEvent, fallbackId: number) => {
    e.preventDefault();
    const ids = selected.size > 0 ? Array.from(selected) : [fallbackId];
    setMenu({ ids, x: e.clientX, y: e.clientY });
  });

  const closeMenu = (): void => setMenu(null);

  const onCancelSelected = useEffectEvent(async (ids: number[]) => {
    setMenu(null);
    for (const id of ids) {
      try {
        await cancelMutation.mutateAsync({ id });
      } catch {
        // 개별 실패는 무시 — UI는 invalidate 후 새 상태로 갱신
      }
    }
    setSelected(new Set());
    await utils.watch.list.invalidate();
  });

  const onEditRow = useEffectEvent((o: WatchOrder) => {
    onEditOrder?.({
      existingId: o.id,
      pdno: o.pdno,
      side: o.side,
      comparator: o.comparator,
      targetPrice: o.targetPrice,
      orderType: o.orderType,
      qtyOrAmountMode: o.qtyOrAmountMode,
      ...(o.qty != null ? { qty: o.qty } : {}),
      ...(o.amountKrw != null ? { amountKrw: o.amountKrw } : {}),
      ...(o.expiresAt != null
        ? {
            expiresAtMs: o.expiresAt instanceof Date ? o.expiresAt.getTime() : Number(o.expiresAt),
          }
        : {}),
    });
  });

  const onDeleteRow = useEffectEvent(async (id: number) => {
    try {
      await cancelMutation.mutateAsync({ id });
    } catch {
      // 무시 — invalidate 후 갱신
    }
    await utils.watch.list.invalidate();
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {menu ? (
        // 메뉴 외부 클릭/Esc 로 close — overlay 버튼이 키보드 포커스 가능.
        <button
          type="button"
          aria-label="컨텍스트 메뉴 닫기"
          onClick={closeMenu}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeMenu();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'default',
            zIndex: 999,
            padding: 0,
          }}
        />
      ) : null}
      {error ? (
        <div className="chip chip--down" role="alert" style={{ margin: '0.5rem' }}>
          {error.message}
        </div>
      ) : null}
      <TableGrid.Root
        variant="hts"
        stickyHeader
        aria-label="자동감시 리스트"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={42} />
          <TableGrid.Cell flex={1}>종목</TableGrid.Cell>
          <TableGrid.Cell flex={1}>구분</TableGrid.Cell>
          <TableGrid.Cell flex={1}>방향</TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            목표가
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={40}>비교</TableGrid.Cell>
          <TableGrid.Cell flex={1}>주문</TableGrid.Cell>
          <TableGrid.Cell flex={1}>상태</TableGrid.Cell>
          <TableGrid.Cell flex={1} className="muted">
            등록
          </TableGrid.Cell>
          <TableGrid.Cell flex={1} className="muted">
            실패사유
          </TableGrid.Cell>
          {allowMutations && <TableGrid.Cell width={88} />}
        </TableGrid.Header>
        <TableGrid.Body>
          {isPending ? (
            <TableGrid.Row>
              <TableGrid.Cell flex={1} className="muted" style={{ textAlign: 'center' }}>
                로드 중…
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : orders.length === 0 ? (
            <TableGrid.Row>
              <TableGrid.Cell flex={1} className="muted" style={{ textAlign: 'center' }}>
                없음
              </TableGrid.Cell>
            </TableGrid.Row>
          ) : (
            orders.map((o) => (
              <TableGrid.Row
                key={o.id}
                selected={selected.has(o.id)}
                onContextMenu={(e) => onContextMenu(e, o.id)}
              >
                <TableGrid.Cell width={42}>
                  <Checkbox
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    aria-label={`선택 ${o.id}`}
                    dense
                  />
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {o.pdno}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1}>{o.source}</TableGrid.Cell>
                <TableGrid.Cell flex={1}>
                  <span className={o.side === 'BUY' ? 'num-up' : 'num-down'}>{o.side}</span>
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {thousandSeparator(o.targetPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} numeric>
                  {o.qtyOrAmountMode === 'QTY'
                    ? thousandSeparator(o.qty ?? 0)
                    : `${thousandSeparator(o.amountKrw ?? 0)}원`}
                </TableGrid.Cell>
                <TableGrid.Cell width={40}>{o.comparator === 'LTE' ? '≤' : '≥'}</TableGrid.Cell>
                <TableGrid.Cell flex={1}>{o.orderType}</TableGrid.Cell>
                <TableGrid.Cell flex={1}>{o.status}</TableGrid.Cell>
                <TableGrid.Cell flex={1} className="muted">
                  {formatDate(o.createdAt)}
                </TableGrid.Cell>
                <TableGrid.Cell flex={1} className="muted">
                  {o.lastFailureReason ?? ''}
                </TableGrid.Cell>
                {allowMutations && (
                  <TableGrid.Cell width={88} style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => onEditRow(o)}
                      disabled={cancelMutation.isPending}
                      className="hts-btn hts-btn--xs"
                      style={inlineActionStyle}
                      aria-label={`수정 ${o.id}`}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteRow(o.id)}
                      disabled={cancelMutation.isPending}
                      className="hts-btn hts-btn--xs hts-btn--danger"
                      style={{ ...inlineActionStyle, color: 'var(--hts-sell, #e03)' }}
                      aria-label={`삭제 ${o.id}`}
                    >
                      삭제
                    </button>
                  </TableGrid.Cell>
                )}
              </TableGrid.Row>
            ))
          )}
        </TableGrid.Body>
      </TableGrid.Root>

      {menu ? (
        <div
          data-testid="watch-context-menu"
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            background: 'var(--bg, #fff)',
            border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '0.25rem 0',
            zIndex: 1000,
            minWidth: '8rem',
            fontSize: '1.1rem',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <MenuItem disabled label="시작 (Wave 5 예정)" onSelect={closeMenu} />
          <MenuItem
            disabled={!allowMutations || cancelMutation.isPending}
            label={`중지 (${menu.ids.length}건)`}
            onSelect={() => void onCancelSelected(menu.ids)}
          />
          <MenuItem
            disabled={!allowMutations || cancelMutation.isPending}
            label={`삭제 (${menu.ids.length}건)`}
            onSelect={() => void onCancelSelected(menu.ids)}
          />
        </div>
      ) : null}
    </div>
  );
};

const inlineActionStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid currentColor',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '1rem',
  padding: '0.4rem 1rem',
  color: 'inherit',
  marginRight: '0.2rem',
};

interface MenuItemProps {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const MenuItem = ({ disabled = false, label, onSelect }: MenuItemProps): ReactElement => (
  <button
    type="button"
    disabled={disabled}
    onClick={onSelect}
    style={{
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '0.35rem 0.8rem',
      background: 'transparent',
      border: 'none',
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--hts-muted, rgba(0,0,0,0.4))' : 'inherit',
      fontSize: 'inherit',
    }}
  >
    {label}
  </button>
);

function formatDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', { hour12: false });
}
