import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PaymentsModule } from './payments.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

/**
 * E2E tests for payment endpoint authentication
 * Verifies that JwtAuthGuard is properly enforced on payment endpoints
 */
describe('PaymentsController Authentication (e2e)', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TypeOrmModule.forRoot({
                    type: 'postgres',
                    host: process.env.DB_HOST || 'localhost',
                    port: parseInt(process.env.DB_PORT || '5432'),
                    username: process.env.DB_USERNAME || 'postgres',
                    password: process.env.DB_PASSWORD || 'postgres',
                    database: process.env.DB_NAME || 'facilpay_test',
                    autoLoadEntities: true,
                    synchronize: false,
                }),
                PaymentsModule,
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('POST /v1/payments (create)', () => {
        it('should return 401 without bearer token', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/payments')
                .send({
                    merchantId: '123e4567-e89b-12d3-a456-426614174000',
                    amount: 100.50,
                    currency: 'USD',
                    description: 'Test payment',
                })
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/payments')
                .set('Authorization', 'Bearer invalid-token-12345')
                .send({
                    merchantId: '123e4567-e89b-12d3-a456-426614174000',
                    amount: 100.50,
                    currency: 'USD',
                    description: 'Test payment',
                })
                .expect(401);

            expect(response.body.statusCode).toBe(401);
        });

        it('should return 401 with malformed authorization header', async () => {
            await request(app.getHttpServer())
                .post('/v1/payments')
                .set('Authorization', 'InvalidFormat')
                .send({
                    merchantId: '123e4567-e89b-12d3-a456-426614174000',
                    amount: 100.50,
                    currency: 'USD',
                    description: 'Test payment',
                })
                .expect(401);
        });
    });

    describe('POST /v1/payments/bulk (createBulk)', () => {
        it('should return 401 without bearer token', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/payments/bulk')
                .send([
                    {
                        merchantId: '123e4567-e89b-12d3-a456-426614174000',
                        amount: 100.50,
                        currency: 'USD',
                        description: 'Test payment 1',
                    },
                    {
                        merchantId: '123e4567-e89b-12d3-a456-426614174000',
                        amount: 200.00,
                        currency: 'USD',
                        description: 'Test payment 2',
                    },
                ])
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            await request(app.getHttpServer())
                .post('/v1/payments/bulk')
                .set('Authorization', 'Bearer invalid-token')
                .send([
                    {
                        merchantId: '123e4567-e89b-12d3-a456-426614174000',
                        amount: 100.50,
                        currency: 'USD',
                        description: 'Test payment',
                    },
                ])
                .expect(401);
        });
    });

    describe('GET /v1/payments (findAll)', () => {
        it('should return 401 without bearer token', async () => {
            const response = await request(app.getHttpServer())
                .get('/v1/payments')
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            await request(app.getHttpServer())
                .get('/v1/payments')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });

        it('should return 401 with query parameters but no token', async () => {
            await request(app.getHttpServer())
                .get('/v1/payments?page=1&limit=10&status=COMPLETED')
                .expect(401);
        });
    });

    describe('GET /v1/payments/:id (findOne)', () => {
        it('should return 401 without bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            const response = await request(app.getHttpServer())
                .get(`/v1/payments/${paymentId}`)
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            await request(app.getHttpServer())
                .get(`/v1/payments/${paymentId}`)
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });
    });

    describe('POST /v1/payments/:id/refund (refund)', () => {
        it('should return 401 without bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            const response = await request(app.getHttpServer())
                .post(`/v1/payments/${paymentId}/refund`)
                .send({
                    amount: 50.00,
                    reason: 'Customer request',
                })
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            await request(app.getHttpServer())
                .post(`/v1/payments/${paymentId}/refund`)
                .set('Authorization', 'Bearer invalid-token')
                .send({
                    amount: 50.00,
                    reason: 'Customer request',
                })
                .expect(401);
        });
    });

    describe('POST /v1/payments/:id/cancel (cancel)', () => {
        it('should return 401 without bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            const response = await request(app.getHttpServer())
                .post(`/v1/payments/${paymentId}/cancel`)
                .expect(401);

            expect(response.body).toMatchObject({
                statusCode: 401,
                message: 'Unauthorized',
            });
        });

        it('should return 401 with invalid bearer token', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';
            await request(app.getHttpServer())
                .post(`/v1/payments/${paymentId}/cancel`)
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
        });
    });

    describe('Cross-endpoint authentication verification', () => {
        it('should reject all payment management endpoints without authentication', async () => {
            const paymentId = '123e4567-e89b-12d3-a456-426614174000';

            // Test all endpoints in parallel
            const results = await Promise.all([
                request(app.getHttpServer()).post('/v1/payments').send({
                    merchantId: paymentId,
                    amount: 100,
                    currency: 'USD',
                }),
                request(app.getHttpServer()).post('/v1/payments/bulk').send([]),
                request(app.getHttpServer()).get('/v1/payments'),
                request(app.getHttpServer()).get(`/v1/payments/${paymentId}`),
                request(app.getHttpServer())
                    .post(`/v1/payments/${paymentId}/refund`)
                    .send({ amount: 50 }),
                request(app.getHttpServer()).post(`/v1/payments/${paymentId}/cancel`),
            ]);

            // All should return 401
            results.forEach((response) => {
                expect(response.status).toBe(401);
                expect(response.body.statusCode).toBe(401);
            });
        });
    });

    describe('Webhook endpoint should remain unguarded', () => {
        it('POST /v1/payments/webhook should not require bearer token (uses WebhookGuard instead)', async () => {
            // This should fail with 400 (missing signature headers) not 401 (unauthorized)
            // because WebhookGuard is signature-based, not JWT-based
            const response = await request(app.getHttpServer())
                .post('/v1/payments/webhook')
                .send({
                    paymentId: '123e4567-e89b-12d3-a456-426614174000',
                    status: 'COMPLETED',
                });

            // Should NOT be 401 - webhook uses its own guard
            expect(response.status).not.toBe(401);
            // Will likely be 400 (bad request due to missing signature) or 403 (forbidden signature)
            expect([400, 403]).toContain(response.status);
        });
    });
});
