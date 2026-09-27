export interface Sep7PaymentInput {
  destination: string;
  amount?: string | number | null;
  assetCode?: string | null;
  assetIssuer?: string | null;
  memo?: string | null;
  memoType?: string | null;
  callback?: string | null;
  originDomain?: string | null;
  signature?: string | null;
}

const NATIVE_ASSET_CODE = 'XLM';

/**
 * Build a SEP-0007 `web+stellar:pay` URI for a payment.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */
export function buildSep7Uri(payment: Sep7PaymentInput): string {
  const params = new URLSearchParams();

  params.set('destination', payment.destination);

  if (payment.amount !== undefined && payment.amount !== null && payment.amount !== '') {
    params.set('amount', String(payment.amount));
  }

  const assetCode = payment.assetCode?.trim();
  if (assetCode && assetCode.toUpperCase() !== NATIVE_ASSET_CODE) {
    params.set('asset_code', assetCode);
    if (payment.assetIssuer) {
      params.set('asset_issuer', payment.assetIssuer);
    }
  }

  if (payment.memo) {
    params.set('memo', payment.memo);
    params.set('memo_type', payment.memoType ?? 'text');
  }

  if (payment.callback) {
    params.set('callback', payment.callback);
  }

  if (payment.originDomain) {
    params.set('origin_domain', payment.originDomain);
  }

  if (payment.signature) {
    params.set('signature', payment.signature);
  }

  return `web+stellar:pay?${params.toString()}`;
}
