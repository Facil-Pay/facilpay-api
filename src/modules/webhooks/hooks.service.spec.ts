import { HooksService } from './hooks.service';

describe('REST hook samples', () => {
  const events = { find: jest.fn() };
  const service = new HooksService(events as any);
  it('uses merchant event history and the selected payload serializer', async () => {
    events.find.mockResolvedValue([{ id: 'event', payload: { id: 'payment' } }]);
    const samples = await service.samples('merchant', 'payment.completed', '2026-10-01');
    expect(events.find).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'merchant', type: 'payment.completed' } }));
    expect(samples[0]).toMatchObject({ id: 'event', eventId: 'event', version: '2026-10-01', data: { id: 'payment' } });
  });
  it('provides a deterministic sample for a merchant without event history', async () => {
    events.find.mockResolvedValue([]);
    const samples = await service.samples('merchant', 'customer.created');
    expect(samples[0]).toMatchObject({ id: 'sample_customer.created', data: { sample: true } });
  });
  it('rejects unknown events and versions', async () => {
    await expect(service.samples('merchant', 'secret.event')).rejects.toThrow('Unknown event');
    await expect(service.samples('merchant', 'customer.created', 'future')).rejects.toThrow('Unsupported payload');
  });
});
