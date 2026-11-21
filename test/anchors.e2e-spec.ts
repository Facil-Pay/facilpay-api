import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DataSource } from 'typeorm';
import { AnchorConfig } from '../src/modules/anchors/entities/anchor-config.entity';
import { AnchorWithdrawal, AnchorWithdrawalStatus } from '../src/modules/anchors/entities/anchor-withdrawal.entity';

describe('Anchors SEP-24 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) => {
          const messages = errors.flatMap((e) =>
            e.constraints ? Object.values(e.constraints) : [],
          );
          return new UnprocessableEntityException(
            messages.length ? messages : 'Validation failed',
          );
        },
      }),
    );
    await app.init();
    ds = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await ds.getRepository(AnchorWithdrawal).delete({});
    await ds.getRepository(AnchorConfig).delete({});
  });

  // ── Anchor config ─────────────────────────────────────────────────────────

  describe('GET /v1/anchors/configs', () => {
    it('returns 401 without a JWT', async () => {
      await request(app.getHttpServer()).get('/v1/anchors/configs').expect(401);
    });

    it('returns an empty array when no configs exist', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/v1/anchors/configs')
        .expect(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('POST /v1/anchors/configs', () => {
    it('creates an anchor config', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/anchors/configs')
        .send({
          homeDomain: 'testanchor.stellar.org',
          supportedAssets: ['USDC', 'SRT'],
        })
        .expect(201);

      expect(body.homeDomain).toBe('testanchor.stellar.org');
      expect(body.supportedAssets).toEqual(['USDC', 'SRT']);
      expect(body.isActive).toBe(true);
    });

    it('returns 409 on duplicate home domain', async () => {
      await ds.getRepository(AnchorConfig).save(
        ds.getRepository(AnchorConfig).create({
          merchantId: 'e2e-merchant',
          homeDomain: 'testanchor.stellar.org',
          supportedAssets: ['USDC'],
          isActive: true,
        }),
      );

      await request(app.getHttpServer())
        .post('/v1/anchors/configs')
        .send({ homeDomain: 'testanchor.stellar.org', supportedAssets: ['USDC'] })
        .expect(409);
    });

    it('returns 422 when supportedAssets is empty', async () => {
      await request(app.getHttpServer())
        .post('/v1/anchors/configs')
        .send({ homeDomain: 'example.com', supportedAssets: [] })
        .expect(422);
    });
  });

  describe('DELETE /v1/anchors/configs/:id', () => {
    it('removes an anchor config', async () => {
      const cfg = await ds.getRepository(AnchorConfig).save(
        ds.getRepository(AnchorConfig).create({
          merchantId: 'e2e-merchant',
          homeDomain: 'delete-me.example.com',
          supportedAssets: ['XLM'],
          isActive: true,
        }),
      );

      await request(app.getHttpServer())
        .delete(`/v1/anchors/configs/${cfg.id}`)
        .expect(204);
    });
  });

  // ── Withdrawals ───────────────────────────────────────────────────────────

  describe('GET /v1/anchors/withdrawals', () => {
    it('returns 401 without a JWT', async () => {
      await request(app.getHttpServer()).get('/v1/anchors/withdrawals').expect(401);
    });

    it('returns a paginated empty list', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/v1/anchors/withdrawals')
        .expect(200);
      expect(body).toMatchObject({ data: [], total: 0 });
    });
  });

  describe('POST /v1/anchors/withdrawals', () => {
    it('returns 404 when the anchor config does not exist', async () => {
      await request(app.getHttpServer())
        .post('/v1/anchors/withdrawals')
        .send({
          anchorConfigId: '00000000-0000-0000-0000-000000000001',
          assetCode: 'USDC',
          amount: '100',
        })
        .expect(404);
    });

    it('returns 400 when the asset is not supported by the anchor', async () => {
      const cfg = await ds.getRepository(AnchorConfig).save(
        ds.getRepository(AnchorConfig).create({
          merchantId: 'e2e-merchant',
          homeDomain: 'asset-check.example.com',
          supportedAssets: ['SRT'],
          isActive: true,
        }),
      );

      // fetchStellarToml will fail (domain doesn't exist) but the asset
      // check happens before the HTTP call, so we get 400
      await request(app.getHttpServer())
        .post('/v1/anchors/withdrawals')
        .send({
          anchorConfigId: cfg.id,
          assetCode: 'USDC',
          amount: '50',
        })
        .expect(400);
    });
  });
});
