// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TableGrid, useTableGridVirtual } from './index';

// useVirtualizer — 화면에 보이는 일부 행만 렌더하도록 stub
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const visible = Math.min(count, 10);
    return {
      getTotalSize: () => count * 32,
      getVirtualItems: () =>
        Array.from({ length: visible }, (_, i) => ({
          key: i,
          index: i,
          start: i * 32,
          size: 32,
          end: (i + 1) * 32,
          lane: 0,
        })),
      measureElement: vi.fn(),
    };
  },
}));

describe('TableGrid', () => {
  describe('Root variant', () => {
    it('variant="hts" 시 data-variant attr 가 부여된다', () => {
      render(
        <TableGrid.Root variant="hts">
          <TableGrid.Header>
            <TableGrid.Cell width={100}>이름</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell width={100}>A</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const root = document.querySelector('.table-grid-root');
      expect(root).toBeInTheDocument();
      expect(root).toHaveAttribute('data-variant', 'hts');
      expect(root).toHaveAttribute('data-zebra', 'true');
    });

    it('variant 미지정 시 plain 으로 폴백된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell>X</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const root = document.querySelector('.table-grid-root');
      expect(root).toHaveAttribute('data-variant', 'plain');
    });
  });

  describe('Cell width / flex', () => {
    it('width 지정 시 flex: 0 0 auto + 고정 width 가 적용된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell width={120} className="cell-fixed">
                fixed
              </TableGrid.Cell>
              <TableGrid.Cell flex={1} className="cell-flex">
                flex
              </TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const fixed = document.querySelector('.cell-fixed') as HTMLElement;
      const flexible = document.querySelector('.cell-flex') as HTMLElement;

      expect(fixed.style.width).toBe('120px');
      expect(fixed.style.flex).toBe('0 0 auto');
      // jsdom 의 flex shorthand 직렬화는 환경에 따라 다름 — style attribute 원문으로 검증
      const flexInline = flexible.getAttribute('style') ?? '';
      expect(flexInline).toMatch(/flex:\s*1 1 0%/);
      expect(flexInline).toMatch(/min-width:\s*0/);
    });
  });

  describe('Cell overflow modes', () => {
    it('각 모드별로 클래스와 인라인 스타일이 적용된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell overflow="nowrap" className="ovf-nowrap">
                A
              </TableGrid.Cell>
              <TableGrid.Cell overflow="ellipsis" className="ovf-ellipsis">
                B
              </TableGrid.Cell>
              <TableGrid.Cell overflow="wrap" className="ovf-wrap">
                C
              </TableGrid.Cell>
              <TableGrid.Cell overflow="scroll" className="ovf-scroll">
                D
              </TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const nowrap = document.querySelector('.ovf-nowrap') as HTMLElement;
      const ellipsis = document.querySelector('.ovf-ellipsis') as HTMLElement;
      const wrap = document.querySelector('.ovf-wrap') as HTMLElement;
      const scroll = document.querySelector('.ovf-scroll') as HTMLElement;

      expect(nowrap.className).toContain('table-grid-cell--ovf-nowrap');
      expect(nowrap.style.whiteSpace).toBe('nowrap');
      expect(nowrap.style.overflow).toBe('hidden');

      expect(ellipsis.className).toContain('table-grid-cell--ovf-ellipsis');
      expect(ellipsis.style.textOverflow).toBe('ellipsis');

      expect(wrap.className).toContain('table-grid-cell--ovf-wrap');
      expect(wrap.style.whiteSpace).toBe('normal');

      expect(scroll.className).toContain('table-grid-cell--ovf-scroll');
      expect(scroll.style.overflowX).toBe('auto');
    });
  });

  describe('Row state', () => {
    it('selected/expanded/flash data-attr 가 부여된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row selected>
              <TableGrid.Cell>sel</TableGrid.Cell>
            </TableGrid.Row>
            <TableGrid.Row expanded>
              <TableGrid.Cell>exp</TableGrid.Cell>
            </TableGrid.Row>
            <TableGrid.Row flash="up">
              <TableGrid.Cell>up</TableGrid.Cell>
            </TableGrid.Row>
            <TableGrid.Row flash="down">
              <TableGrid.Cell>down</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const rows = document.querySelectorAll('[data-grid-role="row"]');
      expect(rows[0]).toHaveAttribute('data-selected', 'true');
      expect(rows[1]).toHaveAttribute('data-expanded', 'true');
      expect(rows[2]).toHaveAttribute('data-flash', 'up');
      expect(rows[3]).toHaveAttribute('data-flash', 'down');
    });

    it('onClick 핸들러가 호출된다', () => {
      const onClick = vi.fn();
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row onClick={onClick}>
              <TableGrid.Cell>clickme</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      fireEvent.click(screen.getByText('clickme'));
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  describe('Numeric cell', () => {
    it('numeric=true 면 num 클래스 + align right 가 적용된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell numeric className="num-cell">
                12,345
              </TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const cell = document.querySelector('.num-cell') as HTMLElement;
      expect(cell.className).toContain('table-grid-cell--num');
      expect(cell.style.textAlign).toBe('right');
      expect(cell).toHaveAttribute('data-numeric', 'true');
    });
  });

  describe('columnDividers', () => {
    it('variant="hts" 기본값은 data-column-dividers="true"', () => {
      render(
        <TableGrid.Root variant="hts">
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell>A</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const root = document.querySelector('.table-grid-root');
      expect(root).toHaveAttribute('data-column-dividers', 'true');
    });

    it('variant="plain" 기본값은 data-column-dividers="false"', () => {
      render(
        <TableGrid.Root variant="plain">
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell>A</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const root = document.querySelector('.table-grid-root');
      expect(root).toHaveAttribute('data-column-dividers', 'false');
    });

    it('columnDividers=false 로 명시하면 hts 에서도 수직선 비활성화', () => {
      render(
        <TableGrid.Root variant="hts" columnDividers={false}>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell>A</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const root = document.querySelector('.table-grid-root');
      expect(root).toHaveAttribute('data-column-dividers', 'false');
    });
  });

  describe('Header sticky', () => {
    it('stickyHeader=true (default) 일 때 position sticky 가 적용된다', () => {
      render(
        <TableGrid.Root>
          <TableGrid.Header>
            <TableGrid.Cell>H</TableGrid.Cell>
          </TableGrid.Header>
          <TableGrid.Body>
            <TableGrid.Row>
              <TableGrid.Cell>R</TableGrid.Cell>
            </TableGrid.Row>
          </TableGrid.Body>
        </TableGrid.Root>,
      );

      const header = document.querySelector('.table-grid-header') as HTMLElement;
      expect(header.style.position).toBe('sticky');
    });
  });

  describe('Compound 외부 사용 가드', () => {
    it('Root 외부에서 Cell 만 렌더하면 throw 된다', () => {
      // Header/Body 가 Root context 를 요구 — 외부 사용 시 명시적 에러
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() =>
        render(
          <TableGrid.Header>
            <TableGrid.Cell>X</TableGrid.Cell>
          </TableGrid.Header>,
        ),
      ).toThrow(/TableGrid sub-component/);
      errSpy.mockRestore();
    });
  });

  describe('Virtualization (useTableGridVirtual)', () => {
    function VirtualHarness({ count }: { count: number }): ReactElement {
      const ref = useRef<HTMLDivElement>(null);
      const { items, totalSize } = useTableGridVirtual({
        count,
        estimateSize: () => 32,
        parentRef: ref,
      });

      return (
        <TableGrid.Root variant="hts">
          <TableGrid.Body scrollRef={ref}>
            <div style={{ height: totalSize, position: 'relative' }}>
              {items.map((vi) => (
                <TableGrid.Row
                  key={vi.key}
                  data-key={String(vi.index)}
                  style={{
                    position: 'absolute',
                    top: vi.start,
                    left: 0,
                    right: 0,
                  }}
                >
                  <TableGrid.Cell>row-{vi.index}</TableGrid.Cell>
                </TableGrid.Row>
              ))}
            </div>
          </TableGrid.Body>
        </TableGrid.Root>
      );
    }

    it('count=1000 이어도 일부 행만 렌더된다 (mock 기준 10건)', () => {
      render(<VirtualHarness count={1000} />);

      const rendered = document.querySelectorAll('[data-grid-role="row"]');
      expect(rendered.length).toBe(10);
      expect(rendered[0]).toHaveAttribute('data-key', '0');
      expect(rendered[9]).toHaveAttribute('data-key', '9');
    });
  });
});
