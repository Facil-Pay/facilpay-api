import { parsePayoutCsv } from './payout-csv.util';

describe('Payout CSV', () => {
  const destination = `G${'A'.repeat(55)}`;
  const header = 'destination,amount,currency,reference,memo\r\n';
  it('accepts CRLF, quoted commas and escaped quotes', () => {
    expect(parsePayoutCsv(`${header}${destination},1.25,usd,ref,"hello, ""friend"""`)[0]).toMatchObject({ currency: 'USD', memo: 'hello, "friend"' });
  });
  it.each([
    `${header}${destination},0,USD,ref,`,
    `${header}${destination},1.00000001,USD,ref,`,
    `${header}${destination},1,USD,ref,"unclosed`,
    `${header}${destination},1,USD,ref,"closed"junk`,
    `${header}${destination},1,USD,ref,${'é'.repeat(15)}`,
    'amount,amount\n1,2',
  ])('rejects invalid rows', csv => expect(() => parsePayoutCsv(csv)).toThrow());
});
