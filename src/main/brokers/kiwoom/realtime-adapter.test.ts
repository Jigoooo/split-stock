import { describe, expect, it } from 'vitest';
import type { BrokerAccountRealtimeEvent, RealtimePhase } from '../ports';
import { KiwoomRealtimeAdapter } from './realtime-adapter';
import type { KiwoomSocketClient, KiwoomWsRealMessage } from './socket-client';

class FakeKiwoomSocket {
  readonly subscribed: Array<{ item: string; type: string }> = [];
  readonly unsubscribed: Array<{ item: string; type: string }> = [];
  private handler: ((msg: KiwoomWsRealMessage) => void) | null = null;

  async connect(): Promise<void> {}

  disconnect(): void {}

  onReal(handler: (msg: KiwoomWsRealMessage) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  subscribe(item: string, type: string): void {
    this.subscribed.push({ item, type });
  }

  unsubscribe(item: string, type: string): void {
    this.unsubscribed.push({ item, type });
  }

  getPhase(): RealtimePhase {
    return 'open';
  }

  emit(msg: KiwoomWsRealMessage): void {
    this.handler?.(msg);
  }
}

describe('KiwoomRealtimeAdapter account events', () => {
  it('주문체결(00)과 잔고(04)를 내부 dirty signal로 변환한다', async () => {
    const socket = new FakeKiwoomSocket();
    const adapter = new KiwoomRealtimeAdapter(socket as unknown as KiwoomSocketClient);
    const events: BrokerAccountRealtimeEvent[] = [];

    await adapter.start();
    const sub = adapter.subscribeAccountEvents((event) => events.push(event));
    expect(sub.isOk()).toBe(true);
    expect(socket.subscribed).toEqual([
      { item: '', type: '00' },
      { item: '', type: '04' },
    ]);

    socket.emit({
      trnm: 'REAL',
      data: [
        {
          type: '00',
          item: '005930',
          values: { '9203': 'ORD-1', '911': '3', '910': '70100', '908': '093001' },
        },
        {
          type: '04',
          item: 'A005930',
          values: { '908': '093002' },
        },
      ],
    });

    expect(events).toEqual([
      {
        kind: 'ORDER_DIRTY',
        brokerOrderId: 'ORD-1',
        symbol: '005930',
        execution: {
          brokerOrderId: 'ORD-1',
          symbol: '005930',
          filledQty: 3,
          price: 70100,
          at: '093001',
        },
        at: '093001',
      },
      { kind: 'BALANCE_DIRTY', symbol: '005930', at: '093002' },
    ]);
  });

  it('체결 전용 구독과 계좌 이벤트 구독이 같은 00 type을 서로 해제하지 않는다', () => {
    const socket = new FakeKiwoomSocket();
    const adapter = new KiwoomRealtimeAdapter(socket as unknown as KiwoomSocketClient);
    const execSub = adapter.subscribeExecutions(() => undefined);
    const accountSub = adapter.subscribeAccountEvents(() => undefined);
    if (execSub.isErr() || accountSub.isErr()) throw new Error('subscription failed');

    expect(socket.subscribed).toEqual([
      { item: '', type: '00' },
      { item: '', type: '04' },
    ]);

    execSub.value.unsubscribe();
    expect(socket.unsubscribed).toEqual([]);
    accountSub.value.unsubscribe();
    expect(socket.unsubscribed).toEqual([
      { item: '', type: '00' },
      { item: '', type: '04' },
    ]);
  });
});
