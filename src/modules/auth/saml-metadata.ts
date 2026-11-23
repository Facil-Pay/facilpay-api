import { BadRequestException } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';
import { X509Certificate } from 'crypto';
const MD = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
export function parseIdpMetadata(xml: string) {
  if (xml.length > 100000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestException('Unsafe metadata XML');
  try {
    const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => { throw Error(); }, fatalError: () => { throw Error(); } } }).parseFromString(xml, 'text/xml');
    const entity = doc.documentElement;
    if (entity.localName !== 'EntityDescriptor' || entity.namespaceURI !== MD) throw Error();
    const issuer = entity.getAttribute('entityID');
    const descriptors = entity.getElementsByTagNameNS(MD, 'IDPSSODescriptor');
    if (!issuer || descriptors.length !== 1) throw Error();
    const idp = descriptors.item(0)!;
    const services = Array.from(idp.getElementsByTagNameNS(MD, 'SingleSignOnService'));
    const service = services.find(item => item.getAttribute('Binding') === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect');
    const entryPoint = service?.getAttribute('Location');
    if (!entryPoint || new URL(entryPoint).protocol !== 'https:') throw Error();
    const certificates: string[] = [];
    for (const key of Array.from(idp.getElementsByTagNameNS(MD, 'KeyDescriptor'))) {
      if (key.getAttribute('use') && key.getAttribute('use') !== 'signing') continue;
      for (const cert of Array.from(key.getElementsByTagNameNS(DS, 'X509Certificate'))) {
        const pem = '-----BEGIN CERTIFICATE-----\n' + cert.textContent?.replace(/\s/g, '') + '\n-----END CERTIFICATE-----';
        new X509Certificate(pem);
        certificates.push(pem);
      }
    }
    if (!certificates.length) throw Error();
    return { issuer, entryPoint, certificates };
  } catch { throw new BadRequestException('Invalid IdP metadata XML'); }
}
