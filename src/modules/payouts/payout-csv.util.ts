import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePayoutDto } from './dto/create-payout.dto';

/** RFC 4180 fields, including escaped quotes and embedded newlines. */
export function parsePayoutCsv(csv: string): CreatePayoutDto[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const endField = () => { row.push(field); field = ''; closed = false; };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      endField(); rows.push(row); row = [];
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (closed || c === '"') throw new BadRequestException('Malformed CSV');
    else field += c;
  }
  if (quoted) throw new BadRequestException('Unterminated CSV field');
  if (field || row.length || closed) { endField(); rows.push(row); }
  const headers = rows.shift()?.map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, '') : h).trim());
  const allowed = ['destination', 'amount', 'currency', 'reference', 'memo'];
  if (!headers || new Set(headers).size !== headers.length ||
      headers.some(h => !allowed.includes(h)) ||
      allowed.slice(0, 4).some(h => !headers.includes(h)) ||
      !rows.length || rows.length > 1000) {
    throw new BadRequestException('CSV requires destination,amount,currency,reference and 1–1000 rows; memo is optional');
  }
  return rows.map((values, index) => {
    const dto = plainToInstance(CreatePayoutDto, Object.fromEntries(headers.map((h, i) => [h, values[i]])));
    if (values.length !== headers.length || validateSync(dto).length || Buffer.byteLength(dto.memo ?? '', 'utf8') > 28) {
      throw new BadRequestException(`Invalid CSV row ${index + 2}`);
    }
    return dto;
  });
}
