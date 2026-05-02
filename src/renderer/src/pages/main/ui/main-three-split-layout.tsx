import type { ReactElement, ReactNode } from 'react';
import { Group, type Layout, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

const HORIZONTAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      width: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'col-resize',
    }}
  />
);

const VERTICAL_SEPARATOR: ReactElement = (
  <Separator
    className="resize-separator"
    style={{
      height: 6,
      background: 'var(--hts-line, rgba(0,0,0,0.08))',
      cursor: 'row-resize',
    }}
  />
);

const panelStyle = { overflow: 'hidden' } as const;
const RESIZE_HIT_AREA = { coarse: 8, fine: 6 } as const;

export interface MainThreeSplitLayoutProps {
  after?: ReactNode;
  bottom: ReactNode;
  layoutIds: {
    horizontal: string;
    vertical: string;
  };
  left: ReactNode;
  right: ReactNode;
}

export function MainThreeSplitLayout({
  after,
  bottom,
  layoutIds,
  left,
  right,
}: MainThreeSplitLayoutProps): ReactElement {
  const horizontalLayout = useDefaultLayout({
    id: layoutIds.horizontal,
    storage: localStorage,
  });
  const verticalLayout = useDefaultLayout({
    id: layoutIds.vertical,
    storage: localStorage,
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Group
        orientation="vertical"
        defaultLayout={(verticalLayout.defaultLayout ?? [70, 30]) as Layout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
        resizeTargetMinimumSize={RESIZE_HIT_AREA}
      >
        <Panel id="main-top" defaultSize={70} minSize={35} style={panelStyle}>
          <Group
            orientation="horizontal"
            defaultLayout={horizontalLayout.defaultLayout}
            onLayoutChanged={horizontalLayout.onLayoutChanged}
            resizeTargetMinimumSize={RESIZE_HIT_AREA}
          >
            <Panel id="main-left" defaultSize={60} minSize={35} style={panelStyle}>
              <div data-testid="main-left" style={{ height: '100%', minHeight: 0 }}>
                {left}
              </div>
            </Panel>
            {HORIZONTAL_SEPARATOR}
            <Panel id="main-right" defaultSize={40} minSize={25} style={panelStyle}>
              <div data-testid="main-right" style={{ height: '100%', minHeight: 0 }}>
                {right}
              </div>
            </Panel>
          </Group>
        </Panel>
        {VERTICAL_SEPARATOR}
        <Panel id="main-bottom" defaultSize={30} minSize={20} style={panelStyle}>
          <div data-testid="main-bottom" style={{ height: '100%', minHeight: 0 }}>
            {bottom}
          </div>
        </Panel>
      </Group>
      {after}
    </div>
  );
}
