import { Button } from '@renderer/shared/ui';
import { getPopoutLabel } from '@shared/popout';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ScrollText, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

export interface HeaderPopoutButtonsProps {
  popout: PopoutApi;
}

const BUTTONS: Array<{
  route: PopoutRoute;
  icon: ReactElement;
}> = [
  { route: 'logs', icon: <ScrollText size={14} /> },
  { route: 'reports', icon: <BarChart3 size={14} /> },
  { route: 'settings', icon: <Settings2 size={14} /> },
];

export const HeaderPopoutButtons = ({ popout }: HeaderPopoutButtonsProps): ReactElement => {
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 1400);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const onOpen = async (route: PopoutRoute, label: string): Promise<void> => {
    const alreadyOpen = popout.isOpen(route);
    await popout.popout(route);
    setFeedback(alreadyOpen ? `${label} 창으로 이동` : `${label} 창 열림`);
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      {BUTTONS.map(({ route, icon }) => {
        const label = getPopoutLabel(route);
        return (
          <Button
            key={route}
            onClick={() => {
              void onOpen(route, label);
            }}
            aria-pressed={popout.isOpen(route)}
            title={`${label} 팝아웃`}
            iconLeading={icon}
            dense
            variant={popout.isOpen(route) ? 'primary' : 'default'}
          >
            {label}
          </Button>
        );
      })}
      <AnimatePresence initial={false}>
        {feedback ? (
          <motion.span
            key={feedback}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.09 }}
            className="chip"
          >
            {feedback}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
