import { describe, expect, it } from 'vitest';
import {
  CredentialsSchema,
  CryptoAutoGuardConfigSchema,
  CryptoAutoIntentSchema,
  CryptoAutoLotSourceSchema,
  CryptoAutoTemplateUpsertInputSchema,
  CryptoAutoTradeHistoryFilterSchema,
  CryptoAutoWatchStatusSchema,
  CryptoAutoWatchUpsertInputSchema,
  CryptoCandleUnitSchema,
  CryptoKrwMarketCodeSchema,
  CryptoOrderIntentSchema,
  CryptoProfitBoosterSchema,
  CryptoStrategyProfileSchema,
  CryptoTransferDirectionSchema,
  createDefaultCryptoStrategyProfile,
  DecimalStringSchema,
  SignedDecimalStringSchema,
  UpbitCredentialsSchema,
} from './index';

describe('crypto contracts', () => {
  it('Upbit credentials require accessKey and secretKey in PROD', () => {
    expect(
      UpbitCredentialsSchema.safeParse({
        env: 'PROD',
        broker: 'UPBIT',
        accessKey: 'access-key-12345',
        secretKey: 'secret-key-12345',
      }).success,
    ).toBe(true);

    expect(
      UpbitCredentialsSchema.safeParse({
        env: 'MOCK',
        broker: 'UPBIT',
        accessKey: 'access-key-12345',
        secretKey: 'secret-key-12345',
      }).success,
    ).toBe(false);
  });

  it('keeps domestic stock credentials compatible', () => {
    expect(
      CredentialsSchema.safeParse({
        env: 'MOCK',
        broker: 'KIS',
        appKey: 'PSKEY_abcdefghij',
        appSecret: 'PSSECRET_abcdefghij',
        accountNo8: '12345678',
        accountProdCd: '01',
      }).success,
    ).toBe(true);
  });

  it('validates Upbit order parameter combinations', () => {
    expect(
      CryptoOrderIntentSchema.safeParse({
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'limit',
        price: '1000000.5',
        volume: '0.001',
      }).success,
    ).toBe(true);

    expect(
      CryptoOrderIntentSchema.safeParse({
        market: 'KRW-BTC',
        side: 'bid',
        ordType: 'price',
        price: '10000',
        volume: '0.001',
      }).success,
    ).toBe(false);

    expect(
      CryptoOrderIntentSchema.safeParse({
        market: 'KRW-BTC',
        side: 'ask',
        ordType: 'limit',
        price: '1000000',
        volume: '0.001',
        timeInForce: 'post_only',
        smpType: 'reduce',
      }).success,
    ).toBe(false);
  });

  it('validates supported Upbit candle units', () => {
    expect(CryptoCandleUnitSchema.safeParse('1m').success).toBe(true);
    expect(CryptoCandleUnitSchema.safeParse('240m').success).toBe(true);
    expect(CryptoCandleUnitSchema.safeParse('D').success).toBe(true);
    expect(CryptoCandleUnitSchema.safeParse('2m').success).toBe(false);
    expect(CryptoCandleUnitSchema.safeParse('Y').success).toBe(false);
  });

  it('keeps unsigned and signed decimal contracts distinct for crypto money fields', () => {
    expect(DecimalStringSchema.safeParse('0.00000001').success).toBe(true);
    expect(DecimalStringSchema.safeParse('-1').success).toBe(false);
    expect(SignedDecimalStringSchema.safeParse('-0.25').success).toBe(true);
  });

  it('validates read-only transfer directions', () => {
    expect(CryptoTransferDirectionSchema.safeParse('deposit').success).toBe(true);
    expect(CryptoTransferDirectionSchema.safeParse('withdraw').success).toBe(true);
    expect(CryptoTransferDirectionSchema.safeParse('withdraw-request').success).toBe(false);
  });

  it('narrows crypto automation to Upbit KRW spot markets', () => {
    expect(CryptoKrwMarketCodeSchema.safeParse('KRW-BTC').success).toBe(true);
    expect(CryptoKrwMarketCodeSchema.safeParse('BTC-ETH').success).toBe(false);
    expect(CryptoKrwMarketCodeSchema.safeParse('USDT-BTC').success).toBe(false);
  });

  it('validates crypto auto intents and guard defaults', () => {
    expect(
      CryptoAutoIntentSchema.safeParse({
        kind: 'plan-buy',
        market: 'KRW-BTC',
        krwAmount: '5000',
        limitPrice: '100000000',
      }).success,
    ).toBe(true);
    expect(
      CryptoAutoIntentSchema.safeParse({
        kind: 'plan-buy',
        market: 'BTC-BTC',
        krwAmount: '5000',
        limitPrice: '100000000',
      }).success,
    ).toBe(false);
    expect(CryptoAutoGuardConfigSchema.parse({}).emergencyDisabled).toBe(true);
  });

  it('keeps simulated and live crypto automation lots distinct', () => {
    expect(CryptoAutoLotSourceSchema.safeParse('dry-run').success).toBe(true);
    expect(CryptoAutoLotSourceSchema.safeParse('live').success).toBe(true);
    expect(CryptoAutoLotSourceSchema.safeParse('paper').success).toBe(false);
  });

  it('validates crypto stage strategy profiles as KRW-only decimal contracts', () => {
    const profile = createDefaultCryptoStrategyProfile('KRW-BTC');

    expect(CryptoStrategyProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      CryptoStrategyProfileSchema.safeParse({
        ...profile,
        market: 'BTC-ETH',
      }).success,
    ).toBe(false);
    expect(
      CryptoStrategyProfileSchema.safeParse({
        ...profile,
        buyRules: [
          { nth: 1, triggerDropPct: '0.03', amountKrw: '5000.5' },
          { nth: 2, triggerDropPct: '0.03', amountKrw: '5000.5' },
          { nth: 3, triggerDropPct: '0.03', amountKrw: '5000.5' },
        ],
      }).success,
    ).toBe(false);
  });

  it('CryptoProfitBoosterSchema: expiresAt 은 0 이상 2^31-1 이하여야 한다', () => {
    expect(CryptoProfitBoosterSchema.safeParse({ expiresAt: 0 }).success).toBe(true);
    expect(CryptoProfitBoosterSchema.safeParse({ expiresAt: 2 ** 31 - 1 }).success).toBe(true);
    expect(CryptoProfitBoosterSchema.safeParse({ expiresAt: null }).success).toBe(true);
    expect(CryptoProfitBoosterSchema.safeParse({ expiresAt: 2 ** 31 }).success).toBe(false);
    expect(CryptoProfitBoosterSchema.safeParse({ expiresAt: -1 }).success).toBe(false);
    // Number.MAX_SAFE_INTEGER → setTimeout overflow 버그 방지
    expect(
      CryptoProfitBoosterSchema.safeParse({ expiresAt: Number.MAX_SAFE_INTEGER }).success,
    ).toBe(false);
  });

  it('validates crypto auto watch and template contracts', () => {
    const profile = createDefaultCryptoStrategyProfile('KRW-BTC');

    expect(CryptoAutoWatchStatusSchema.safeParse('WATCHING').success).toBe(true);
    expect(CryptoAutoWatchStatusSchema.safeParse('RUNNING').success).toBe(false);
    expect(
      CryptoAutoWatchUpsertInputSchema.safeParse({
        market: 'KRW-BTC',
        status: 'WATCHING',
        entryCondition: { type: 'price-below', price: '100000000' },
        strategy: profile,
      }).success,
    ).toBe(true);
    expect(
      CryptoAutoWatchUpsertInputSchema.safeParse({
        market: 'BTC-ETH',
        strategy: { ...profile, market: 'BTC-ETH' },
      }).success,
    ).toBe(false);
    expect(
      CryptoAutoTemplateUpsertInputSchema.safeParse({
        name: '기본 템플릿',
        strategy: profile,
      }).success,
    ).toBe(true);
    expect(CryptoAutoTradeHistoryFilterSchema.parse(undefined)).toBeUndefined();
  });
});
