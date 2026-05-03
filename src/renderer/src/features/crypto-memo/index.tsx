import { trpc } from '@renderer/shared/api/trpc';
import { Button, TextInput } from '@renderer/shared/ui';
import { type ReactElement, useEffect, useState } from 'react';

/**
 * 코인 마켓 메모 폼 — symbol-memo의 코인 미러. (RALPLAN P6 A5)
 */
export const CryptoMemoForm = ({ market }: { market: string }): ReactElement => {
  const utils = trpc.useUtils();
  const memoQuery = trpc.cryptoMemo.get.useQuery({ market }, { enabled: market.length > 0 });
  const setMemo = trpc.cryptoMemo.set.useMutation({
    onSuccess: () => {
      void utils.cryptoMemo.get.invalidate({ market });
    },
  });
  const [content, setContent] = useState('');

  useEffect(() => {
    setContent(memoQuery.data?.content ?? '');
  }, [memoQuery.data?.content]);

  return (
    <section className="panel" style={{ display: 'grid', gap: '0.6rem' }}>
      <div className="panel__title">메모 ({market})</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.5rem' }}>
        <TextInput
          aria-label="코인 마켓 메모"
          dense
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="이 마켓에 대한 메모를 입력하세요"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
          {memoQuery.data?.updatedAt ? (
            <span className="muted" style={{ fontSize: '0.85em', alignSelf: 'center' }}>
              마지막 저장: {new Date(memoQuery.data.updatedAt).toLocaleString('ko-KR')}
            </span>
          ) : null}
          <Button
            dense
            variant="primary"
            disabled={setMemo.isPending}
            onClick={() => setMemo.mutate({ market, content })}
          >
            저장
          </Button>
        </div>
      </div>
    </section>
  );
};
