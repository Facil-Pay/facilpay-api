import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { User } from './../src/modules/users/user.entity';
import { UserRole } from './../src/common/constants/roles';

describe('Auth unlock + merchant fee self-service (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  const suffix = Date.now();

  const adminCreds = {
    email: `admin-${suffix}@example.com`,
    password: 'AdminPass1!',
  };
  const merchantCreds = {
    email: `merchant-${suffix}@example.com`,
    password: 'MerchantPass1!',
  };
  const otherCreds = {
    email: `other-${suffix}@example.com`,
    password: 'OtherPass1!',
  };

  let adminId: string;
  let merchantId: string;
  let otherUserId: string;
  let adminToken: string;
  let merchantToken: string;

  const createUser = async (payload: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/v1/users')
      .send(payload)
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const dataSource = app.get(DataSource);
    userRepo = dataSource.getRepository(User);

    adminId = await createUser(adminCreds);
    merchantId = await createUser(merchantCreds);
    otherUserId = await createUser(otherCreds);

    await userRepo.update(adminId, {
      isEmailVerified: true,
      roles: [UserRole.ADMIN],
    });
    await userRepo.update(merchantId, {
      isEmailVerified: true,
      roles: [UserRole.USER],
    });
    await userRepo.update(otherUserId, {
      isEmailVerified: true,
      roles: [UserRole.USER],
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 1000 * 60 * 15),
    });

    adminToken = (
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send(adminCreds)
        .expect(200)
    ).body.access_token;

    merchantToken = (
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send(merchantCreds)
        .expect(200)
    ).body.access_token;

  });

  afterAll(async () => {
    await app.close();
  });

  it('allows admin token to unlock account', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/auth/unlock/${otherUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.id).toBe(otherUserId);
    expect(response.body.failedLoginAttempts).toBe(0);
    expect(response.body.lockedUntil).toBeNull();
  });

  it('forbids non-admin users from unlocking account', async () => {
    await request(app.getHttpServer())
      .post(`/v1/auth/unlock/${otherUserId}`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(403);
  });

  it('lets merchant fetch own fee config and report', async () => {
    await request(app.getHttpServer())
      .post(`/v1/payments/merchant-fee-config/${merchantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        merchantId,
        flatFee: 1.25,
        percentageFee: 2.5,
        minFee: 0.5,
      })
      .expect(201);

    const feeConfigResponse = await request(app.getHttpServer())
      .get('/v1/merchants/me/fee-config')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);

    expect(feeConfigResponse.body.merchantId).toBe(merchantId);
    expect(Number(feeConfigResponse.body.flatFee)).toBe(1.25);
    expect(Number(feeConfigResponse.body.percentageFee)).toBe(2.5);
    expect(Number(feeConfigResponse.body.minFee)).toBe(0.5);

    const feeReportResponse = await request(app.getHttpServer())
      .get('/v1/merchants/me/fee-report')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);

    expect(feeReportResponse.body.merchantId).toBe(merchantId);
    expect(feeReportResponse.body).toHaveProperty('totalGrossAmount');
    expect(feeReportResponse.body).toHaveProperty('totalFeeAmount');
    expect(feeReportResponse.body).toHaveProperty('totalNetAmount');
  });

  it('prevents merchant from fetching another merchant fee data through admin-only endpoint', async () => {
    await request(app.getHttpServer())
      .get(`/v1/payments/merchant-fee-config/${otherUserId}/report`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(403);
  });
});
