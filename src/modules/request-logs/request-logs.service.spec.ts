import { Repository } from 'typeorm';
import { RequestLog } from './request-log.entity';
import { RequestLogsService } from './request-logs.service';
import { redact } from './redact';
describe('Request logs', () => {
  it('redacts nested secrets, arrays, free text and mixed-case credentials', () => {
    const result = redact({ Password: 'p', nested: [{ access_token: 't', secret: 's', apiKey: 'k' }], comment: 'Bearer credential', currency: 'USD' });
    expect(JSON.stringify(result)).not.toMatch(/credential|"p"|"t"|"s"|"k"/);
    expect(result).toMatchObject({ Password: '[REDACTED]', currency: 'USD' });
  });
  it('handles cycles and does not mutate input', () => {
    const input: any = { password: 'secret' }; input.self = input;
    expect(() => JSON.stringify(redact(input))).not.toThrow();
    expect(input.password).toBe('secret');
  });
  it('defers persistence until a later event loop turn', async () => {
    const repo = { create: jest.fn(value => value), save: jest.fn(async () => undefined) };
    const service = new RequestLogsService(repo as unknown as Repository<RequestLog>);
    service.enqueue({ merchantId: 'owner', requestBody: { password: 'secret' } });
    expect(repo.save).not.toHaveBeenCalled();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ requestBody: { password: '[REDACTED]' } }));
  });
  it('scopes reads by merchant and hides expired records', async () => {
    const repo = { findOneBy: jest.fn(async () => null) };
    const service = new RequestLogsService(repo as unknown as Repository<RequestLog>);
    await expect(service.get('owner', 'id')).rejects.toThrow('Request log not found');
    expect(repo.findOneBy).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 'owner', id: 'id', createdAt: expect.anything() }));
  });
  it('deletes entries older than thirty days', async () => {
    const repo = { delete: jest.fn(async () => ({ affected: 2 })) };
    await new RequestLogsService(repo as unknown as Repository<RequestLog>).prune();
    expect(repo.delete).toHaveBeenCalledWith({ createdAt: expect.objectContaining({ _type: 'lessThan' }) });
  });
});
