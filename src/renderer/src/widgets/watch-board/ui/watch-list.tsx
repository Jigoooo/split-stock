import type { WatchOrder } from '@renderer/entities/watch-order';
import type { WatchOrderFormPrefill } from '@renderer/features/add-watch-order';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { Checkbox, TableGrid } from '@renderer/shared/ui';
import { type ReactElement, useEffectEvent, useState } from 'react';

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
        horizontalScroll
        aria-label="자동감시 리스트"
        style={{ flex: 1, minHeight: 0 }}
      >
        <TableGrid.Header>
          <TableGrid.Cell width={42} />
          <TableGrid.Cell width={80}>종목</TableGrid.Cell>
          <TableGrid.Cell width={72}>구분</TableGrid.Cell>
          <TableGrid.Cell width={60}>방향</TableGrid.Cell>
          <TableGrid.Cell width={90} numeric>
            목표가
          </TableGrid.Cell>
          <TableGrid.Cell width={90} numeric>
            수량
          </TableGrid.Cell>
          <TableGrid.Cell width={40}>비교</TableGrid.Cell>
          <TableGrid.Cell width={72}>주문</TableGrid.Cell>
          <TableGrid.Cell width={72}>상태</TableGrid.Cell>
          <TableGrid.Cell width={148} className="muted">
            등록
          </TableGrid.Cell>
          <TableGrid.Cell width={120} className="muted">
            실패사유
          </TableGrid.Cell>
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
                style={{ position: 'relative' }}
              >
                <TableGrid.Cell width={42}>
                  <Checkbox
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    aria-label={`선택 ${o.id}`}
                    dense
                  />
                </TableGrid.Cell>
                <TableGrid.Cell width={80} numeric>
                  {o.pdno}
                </TableGrid.Cell>
                <TableGrid.Cell width={72}>{o.source}</TableGrid.Cell>
                <TableGrid.Cell width={60}>
                  <span className={o.side === 'BUY' ? 'num-up' : 'num-down'}>{o.side}</span>
                </TableGrid.Cell>
                <TableGrid.Cell width={90} numeric>
                  {thousandSeparator(o.targetPrice)}
                </TableGrid.Cell>
                <TableGrid.Cell width={90} numeric>
                  {o.qtyOrAmountMode === 'QTY'
                    ? thousandSeparator(o.qty ?? 0)
                    : `${thousandSeparator(o.amountKrw ?? 0)}원`}
                </TableGrid.Cell>
                <TableGrid.Cell width={40}>{o.comparator === 'LTE' ? '≤' : '≥'}</TableGrid.Cell>
                <TableGrid.Cell width={72}>{o.orderType}</TableGrid.Cell>
                <TableGrid.Cell width={72}>{o.status}</TableGrid.Cell>
                <TableGrid.Cell width={148} className="muted">
                  {formatDate(o.createdAt)}
                </TableGrid.Cell>
                <TableGrid.Cell width={120} className="muted">
                  {o.lastFailureReason ?? ''}
                </TableGrid.Cell>
                {allowMutations && (
                  <button
                    type="button"
                    className="watch-list-more-btn"
                    aria-label={`더보기 ${o.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onContextMenu(e, o.id);
                    }}
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'var(--hts-bg, #1a1a2e)',
                      border: '1px solid var(--hts-line, rgba(255,255,255,0.15))',
                      borderRadius: 3,
                      color: 'inherit',
                      cursor: 'pointer',
                      fontSize: '1rem',
                      lineHeight: 1,
                      padding: '0.2rem 0.5rem',
                      opacity: 0,
                      transition: 'opacity 0.1s',
                      zIndex: 1,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '0';
                    }}
                  >
                    ···
                  </button>
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
          {allowMutations && menu.ids.length === 1 ? (
            <MenuItem
              disabled={cancelMutation.isPending}
              label="수정"
              onSelect={() => {
                const target = orders.find((o) => o.id === menu.ids[0]);
                if (target) onEditRow(target);
                closeMenu();
              }}
            />
          ) : null}
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
