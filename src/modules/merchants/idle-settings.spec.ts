import { validate } from 'class-validator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { MerchantsService } from './merchants.service';
import { MerchantSettings } from './entities/merchant-settings.entity';

describe('Merchant idle timeout settings', () => {
  it.each([null, undefined, 1, 30, 43200])('accepts %s minutes', async value => {
    expect(await validate(Object.assign(new UpdateSettingsDto(), { idleSessionTimeoutMinutes: value }))).toEqual([]);
  });
  it.each([0, -1, 1.5, 43201, '30'])('rejects invalid timeout %s', async value => {
    expect(await validate(Object.assign(new UpdateSettingsDto(), { idleSessionTimeoutMinutes: value }))).not.toEqual([]);
  });
  it('defaults to no timeout, preserves unrelated settings and supports disabling', async () => {
    const settings = Object.assign(new MerchantSettings(), { merchantId: 'm1', timezone: 'Africa/Lagos' });
    expect(settings.idleSessionTimeoutMinutes).toBeNull();
    const repo = { findOneBy: jest.fn().mockResolvedValue(settings), save: jest.fn(value => Promise.resolve(value)) };
    const service: MerchantsService = Object.assign(Object.create(MerchantsService.prototype), { settingsRepo: repo });
    expect(await service.upsertSettings('m1', { idleSessionTimeoutMinutes: 15 })).toMatchObject({ idleSessionTimeoutMinutes: 15, timezone: 'Africa/Lagos' });
    expect(await service.upsertSettings('m1', { idleSessionTimeoutMinutes: null })).toMatchObject({ idleSessionTimeoutMinutes: null });
  });
});
