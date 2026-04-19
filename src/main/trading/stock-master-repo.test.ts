import { describe, expect, it } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { StockMasterRepo } from './stock-master-repo';

function fresh() {
  const db = createTestDb();
  bootstrapSchema(db);
  return new StockMasterRepo(db);
}

describe('StockMasterRepo', () => {
  it('upsertMany + find 라운드트립 (insert 경로)', () => {
    const repo = fresh();
    const n = repo.upsertMany([
      { pdno: '005930', name: '삼성전자', sector: '반도체' },
      { pdno: '000660', name: 'SK하이닉스' },
    ]);
    expect(n).toBe(2);

    const samsung = repo.find('005930');
    expect(samsung?.name).toBe('삼성전자');
    expect(samsung?.sector).toBe('반도체');

    const skhynix = repo.find('000660');
    expect(skhynix?.sector).toBeNull();
  });

  it('upsertMany 재호출은 update (덮어쓰기)', () => {
    const repo = fresh();
    repo.upsertMany([{ pdno: '005930', name: '삼성전자' }]);
    repo.upsertMany([{ pdno: '005930', name: '삼성전자(수정)', sector: '반도체' }]);
    const samsung = repo.find('005930');
    expect(samsung?.name).toBe('삼성전자(수정)');
    expect(samsung?.sector).toBe('반도체');
  });

  it('search: 한글명 부분일치 + 종목코드 부분일치', () => {
    const repo = fresh();
    repo.upsertMany([
      { pdno: '005930', name: '삼성전자' },
      { pdno: '005935', name: '삼성전자우' },
      { pdno: '000660', name: 'SK하이닉스' },
    ]);
    const byName = repo.search('삼성');
    expect(byName.map((x) => x.pdno).sort()).toEqual(['005930', '005935']);

    const byCode = repo.search('00066');
    expect(byCode.map((x) => x.pdno)).toEqual(['000660']);

    const empty = repo.search('  ');
    expect(empty).toHaveLength(0);
  });

  it('find: 없으면 null', () => {
    const repo = fresh();
    expect(repo.find('999999')).toBeNull();
  });

  it('list: 페이징 + 이름 오름차순 정렬', () => {
    const repo = fresh();
    repo.upsertMany([
      { pdno: '005930', name: '삼성전자' },
      { pdno: '000660', name: 'SK하이닉스' },
      { pdno: '035720', name: '카카오' },
      { pdno: '051910', name: 'LG화학' },
    ]);
    const page1 = repo.list({ offset: 0, limit: 2 });
    expect(page1.map((x) => x.name)).toEqual(['LG화학', 'SK하이닉스']);
    const page2 = repo.list({ offset: 2, limit: 2 });
    expect(page2.map((x) => x.name)).toEqual(['삼성전자', '카카오']);
  });

  it('list + countAll: keyword 필터 결과 수 일치', () => {
    const repo = fresh();
    repo.upsertMany([
      { pdno: '005930', name: '삼성전자' },
      { pdno: '005935', name: '삼성전자우' },
      { pdno: '000660', name: 'SK하이닉스' },
    ]);
    const filtered = repo.list({ offset: 0, limit: 10, keyword: '삼성' });
    expect(filtered).toHaveLength(2);
    expect(repo.countAll('삼성')).toBe(2);
    expect(repo.countAll()).toBe(3);
  });

  it('countAll: 빈 DB는 0', () => {
    const repo = fresh();
    expect(repo.countAll()).toBe(0);
    expect(repo.countAll('삼성')).toBe(0);
  });
});
