export interface WsSubscriptionLike {
  tr: string;
  code: string;
}

export function subscriptionId(sub: WsSubscriptionLike): string {
  return `${sub.tr}:${sub.code}`;
}

export function buildSubscriptionControlFrame(
  approvalKey: string,
  sub: WsSubscriptionLike,
  type: '1' | '2',
): {
  header: {
    approval_key: string;
    custtype: 'P';
    tr_type: '1' | '2';
    'content-type': 'utf-8';
  };
  body: { input: { tr_id: string; tr_key: string } };
} {
  return {
    header: {
      approval_key: approvalKey,
      custtype: 'P',
      tr_type: type,
      'content-type': 'utf-8',
    },
    body: { input: { tr_id: sub.tr, tr_key: sub.code } },
  };
}
