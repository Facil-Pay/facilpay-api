import { BadRequestException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';

export interface SettlementAssetRef {
  code: string;
  issuer: string | null;
  normalized: string;
  asset: StellarSdk.Asset;
}

export function parseSettlementAsset(
  input: string | null | undefined,
): SettlementAssetRef | null {
  if (input === null || input === undefined || String(input).trim() === '') {
    return null;
  }
  const value = String(input).trim();
  if (value.toUpperCase() === 'XLM') {
    return {
      code: 'XLM',
      issuer: null,
      normalized: 'XLM',
      asset: StellarSdk.Asset.native(),
    };
  }

  const match = /^([A-Z0-9]{1,12}):([A-Z2-7]{56})$/i.exec(value);
  if (
    !match ||
    !StellarSdk.StrKey.isValidEd25519PublicKey(match[2].toUpperCase())
  ) {
    throw new BadRequestException(
      'Asset must be XLM or CODE:ISSUER with a valid Stellar issuer',
    );
  }
  const code = match[1].toUpperCase();
  const issuer = match[2].toUpperCase();
  return {
    code,
    issuer,
    normalized: `${code}:${issuer}`,
    asset: new StellarSdk.Asset(code, issuer),
  };
}

export function sameSettlementAsset(
  left: SettlementAssetRef | null,
  right: SettlementAssetRef | null,
): boolean {
  if (!left || !right) return false;
  return left.code === right.code && left.issuer === right.issuer;
}

export function assetFromPath(entry: {
  native: boolean;
  assetCode: string;
  assetIssuer: string | null;
}): StellarSdk.Asset {
  if (entry.native || entry.assetCode === 'XLM')
    return StellarSdk.Asset.native();
  if (!entry.assetIssuer) {
    throw new BadRequestException(
      'Intermediate path asset is missing its issuer',
    );
  }
  return new StellarSdk.Asset(entry.assetCode, entry.assetIssuer);
}

export function toStellarAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestException(
      'Amount must be positive for Stellar conversion',
    );
  }
  return amount.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
}
