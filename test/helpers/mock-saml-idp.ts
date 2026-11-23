import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { SignedXml } from 'xml-crypto';

// Ephemeral self-signed credentials, generated only when the tests run.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const bytes = Buffer.concat(parts);
  const hex = bytes.length.toString(16).padStart(bytes.length.toString(16).length + bytes.length.toString(16).length % 2, '0');
  const length = bytes.length < 128 ? Buffer.from([bytes.length]) : Buffer.concat([Buffer.from([0x80 + hex.length / 2]), Buffer.from(hex, 'hex')]);
  return Buffer.concat([Buffer.from([tag]), length, bytes]);
}
export function mockSamlIdp() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const name = der(0x30, der(0x31, der(0x30, Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('Mock IdP')))));
  const validity = der(0x30, der(0x17, Buffer.from('200101000000Z')), der(0x17, Buffer.from('491231235959Z')));
  const tbs = der(0x30, der(0xa0, der(2, Buffer.from([2]))), der(2, Buffer.from([1])), algorithm, name, validity, name, publicKey.export({ type: 'spki', format: 'der' }));
  const certificate = der(0x30, tbs, algorithm, der(3, Buffer.from([0]), sign('RSA-SHA256', tbs, privateKey))).toString('base64');
  const pem = '-----BEGIN CERTIFICATE-----\n' + certificate + '\n-----END CERTIFICATE-----';
  const issuer = 'https://idp.example.com';
  const metadata = '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="' + issuer + '"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>' + certificate + '</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/></IDPSSODescriptor></EntityDescriptor>';
  function signed(xml: string, element: string): string {
    const signer = new SignedXml({ privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicCert: pem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' });
    signer.addReference({ xpath: "//*[local-name()='" + element + "']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
    signer.computeSignature(xml, { location: { reference: "//*[local-name()='" + element + "']/*[local-name()='Issuer']", action: 'after' } });
    return signer.getSignedXml();
  }
  function response(audience: string, callback: string, options: { email?: string; expired?: boolean; requestId?: string } = {}) {
    const now = new Date().toISOString(), before = new Date(Date.now() - 60000).toISOString();
    const after = new Date(Date.now() + (options.expired ? -10000 : 120000)).toISOString();
    const request = options.requestId ? ' InResponseTo="' + options.requestId + '"' : '';
    const assertion = signed('<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_' + randomUUID() + '" Version="2.0" IssueInstant="' + now + '"><saml:Issuer>' + issuer + '</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">' + (options.email ?? 'new@example.com') + '</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="' + callback + '" NotOnOrAfter="' + after + '"' + request + '/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="' + before + '" NotOnOrAfter="' + after + '"><saml:AudienceRestriction><saml:Audience>' + audience + '</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="' + now + '" SessionIndex="mock"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion>', 'Assertion');
    const xml = '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_' + randomUUID() + '" Version="2.0" IssueInstant="' + now + '" Destination="' + callback + '"' + request + '><saml:Issuer>' + issuer + '</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>' + assertion + '</samlp:Response>';
    return Buffer.from(signed(xml, 'Response')).toString('base64');
  }
  return { metadata, response };
}
