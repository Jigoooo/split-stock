import { describe, expect, it } from 'vitest';
import {
  CredentialsSchema,
  CryptoCandleUnitSchema,
  CryptoOrderIntentSchema,
  CryptoTransferDirectionSchema,
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
});
