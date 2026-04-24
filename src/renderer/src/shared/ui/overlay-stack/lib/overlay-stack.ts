import { create } from 'zustand';

const MAX_OVERLAY_STACK_DEPTH = 10;

export enum OverlayType {
  Alert = 'alert',
  Dialog = 'dialog',
}

export type OverlayEntry = {
  id: string;
  type: OverlayType;
  resolve: (value: boolean) => void;
};

type OverlayStackState = {
  stack: OverlayEntry[];
  pendingBacks: number;
};

type OverlayStackActions = {
  push: (id: string, type: OverlayType, resolve: (value: boolean) => void) => void;
  pop: () => OverlayEntry | undefined;
  closeModal: (id: string) => void;
  closeWithBack: (id: string) => void;
  peek: () => OverlayEntry | undefined;
  has: (id: string) => boolean;
  flushAll: () => void;
  decrementPendingBacks: () => number;
};

type OverlayStackStore = OverlayStackState & {
  actions: OverlayStackActions;
};

export function pushOverlayHistoryState(id: string): void {
  if (typeof window === 'undefined') return;

  const currentState =
    typeof window.history.state === 'object' && window.history.state !== null
      ? window.history.state
      : {};

  window.history.pushState({ ...currentState, modalId: id }, '');
}

export const useOverlayStackStore = create<OverlayStackStore>()((setState, getState) => ({
  stack: [],
  pendingBacks: 0,
  actions: {
    push: (id, type, resolve) => {
      const { stack } = getState();
      if (stack.some((entry) => entry.id === id)) return;
      if (stack.length >= MAX_OVERLAY_STACK_DEPTH) return;
      setState({ stack: [...stack, { id, type, resolve }] });
    },
    pop: () => {
      const { stack } = getState();
      if (stack.length === 0) return undefined;

      const top = stack[stack.length - 1];
      if (!top) return undefined;

      setState({ stack: stack.slice(0, -1) });
      return top;
    },
    closeModal: (id) => {
      const { stack } = getState();
      const entry = stack.find((item) => item.id === id);
      if (!entry) return;

      entry.resolve(false);
      setState({ stack: stack.filter((item) => item.id !== id) });
    },
    closeWithBack: (id) => {
      const { stack } = getState();
      const entry = stack.find((item) => item.id === id);

      if (entry) {
        entry.resolve(false);
        setState((state) => ({
          stack: state.stack.filter((item) => item.id !== id),
          pendingBacks: state.pendingBacks + 1,
        }));
      } else {
        setState((state) => ({ pendingBacks: state.pendingBacks + 1 }));
      }

      if (typeof window !== 'undefined') {
        window.history.back();
      }
    },
    peek: () => {
      const { stack } = getState();
      return stack.length > 0 ? stack[stack.length - 1] : undefined;
    },
    has: (id) => {
      const { stack } = getState();
      return stack.some((entry) => entry.id === id);
    },
    flushAll: () => {
      const { stack } = getState();
      if (stack.length === 0) return;

      const length = stack.length;
      stack.forEach((entry) => {
        entry.resolve(false);
      });
      setState((state) => ({ stack: [], pendingBacks: state.pendingBacks + length }));
    },
    decrementPendingBacks: () => {
      const { pendingBacks } = getState();
      const next = Math.max(0, pendingBacks - 1);
      setState({ pendingBacks: next });
      return next;
    },
  },
}));

export const overlayStackActions = useOverlayStackStore.getState().actions;
