import { Button } from '@renderer/shared/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, BarChart3, ClipboardList, ScrollText, Settings2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { PopoutRoute } from '../model/popout-route';
import type { PopoutApi } from '../model/use-popout-state';

export interface HeaderPopoutButtonsProps {
  popout: PopoutApi;
}

const BUTTONS: Array<{
  route: PopoutRoute;
  label: string;
  icon: ReactElement;
}> = [
  { route: 'lots-log', label: '잔고(차수) 로그', icon: <ClipboardList size={14} /> },
  { route: 'logs', label: '이벤트 로그', icon: <ScrollText size={14} /> },
  { route: 'trade', label: '주문', icon: <ArrowLeftRight size={14} /> },
  { route: 'reports', label: '리포트', icon: <BarChart3 size={14} /> },
  { route: 'settings', label: '설정', icon: <Settings2 size={14} /> },
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
      {BUTTONS.map(({ route, label, icon }) => (
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
      ))}
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
