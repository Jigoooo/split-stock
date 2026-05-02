import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CRYPTO_AUTO_FILES = [
  'src/main/crypto/crypto-auto-repo.ts',
  'src/main/crypto/crypto-auto-service.ts',
] as const;

const FORBIDDEN_STOCK_IMPORTS = [
  '../brokers/ports/broker-port',
  '../trading/fsm',
  '../trading/lots-repo',
  '../trading/market-session-guard',
  '../trading/strategy-repo',
  '../trading/strategy-execution-engine',
] as const;

describe('crypto auto-trading dependency boundary', () => {
  it('does not import domestic stock auto-trading modules into crypto automation', () => {
    for (const relative of CRYPTO_AUTO_FILES) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      for (const forbidden of FORBIDDEN_STOCK_IMPORTS) {
        expect(source, `${relative} must not import ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
