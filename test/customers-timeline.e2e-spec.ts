import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Customers Timeline (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let merchantId: string;
  let customerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    // Create a test user and authenticate (adjust based on your auth flow)
    // This is a placeholder; replace with actual auth setup
    const authResponse = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        email: 'timeline-test@example.com',
        password: 'SecurePassword123!',
        name: 'Timeline Tester',
      });

    authToken = authResponse.body.accessToken;
    merchantId = authResponse.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/customers/:id/notes', () => {
    beforeEach(async () => {
      // Create a test customer
      const customerResponse = await request(app.getHttpServer())
        .post('/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'customer-timeline@example.com',
          name: 'Timeline Customer',
        });

      customerId = customerResponse.body.id;
    });

    it('should create a note for the customer', async () => {
      const noteData = {
        content: 'Customer requested a callback regarding refund',
      };

      return request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(noteData)
        .expect(201)
        .expect((res) => {
          expect(res.body.content).toBe(noteData.content);
          expect(res.body.customerId).toBe(customerId);
          expect(res.body.authorId).toBeDefined();
          expect(res.body.id).toBeDefined();
        });
    });

    it('should validate note content is not empty', async () => {
      return request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: '' })
        .expect(400);
    });

    it('should enforce maximum note length', async () => {
      const longContent = 'a'.repeat(5001);

      return request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: longContent })
        .expect(400);
    });
  });

  describe('GET /v1/customers/:id/notes', () => {
    beforeEach(async () => {
      const customerResponse = await request(app.getHttpServer())
        .post('/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'customer-notes@example.com',
          name: 'Notes Customer',
        });

      customerId = customerResponse.body.id;

      // Create some notes
      await request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'First note' });

      await request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Second note' });
    });

    it('should return notes ordered newest first', async () => {
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThanOrEqual(2);
          expect(res.body[0].content).toBe('Second note');
          expect(res.body[1].content).toBe('First note');
        });
    });
  });

  describe('GET /v1/customers/:id/wallets', () => {
    beforeEach(async () => {
      const customerResponse = await request(app.getHttpServer())
        .post('/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'customer-wallets@example.com',
          name: 'Wallet Customer',
        });

      customerId = customerResponse.body.id;
    });

    it('should return empty array for customer with no wallets', async () => {
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/wallets`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(0);
        });
    });
  });

  describe('GET /v1/customers/:id/timeline', () => {
    beforeEach(async () => {
      const customerResponse = await request(app.getHttpServer())
        .post('/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'customer-timeline@example.com',
          name: 'Timeline Customer',
        });

      customerId = customerResponse.body.id;

      // Create a note
      await request(app.getHttpServer())
        .post(`/v1/customers/${customerId}/notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Customer timeline test note' });
    });

    it('should return a timeline with notes', async () => {
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/timeline`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);
          
          const noteEvent = res.body.data.find((e: any) => e.type === 'note');
          expect(noteEvent).toBeDefined();
          expect(noteEvent.data.content).toBe('Customer timeline test note');
        });
    });

    it('should support cursor pagination', async () => {
      // Create multiple notes
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post(`/v1/customers/${customerId}/notes`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ content: `Note ${i}` });
      }

      // Get first page
      const firstPage = await request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/timeline?limit=2`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(firstPage.body.data.length).toBe(2);
      expect(firstPage.body.nextCursor).toBeDefined();

      // Get second page
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/timeline?limit=2&cursor=${firstPage.body.nextCursor}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeGreaterThan(0);
          expect(res.body.data.length).toBeLessThanOrEqual(2);
        });
    });

    it('should respect limit parameter', async () => {
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/timeline?limit=1`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.length).toBeLessThanOrEqual(1);
        });
    });

    it('should enforce maximum limit', async () => {
      return request(app.getHttpServer())
        .get(`/v1/customers/${customerId}/timeline?limit=1000`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          // Service should cap at 100
          expect(res.body.data.length).toBeLessThanOrEqual(100);
        });
    });
  });

  describe('DELETE /v1/customers/:id/wallets/:walletId', () => {
    let walletId: string;

    beforeEach(async () => {
      const customerResponse = await request(app.getHttpServer())
        .post('/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          email: 'customer-delete-wallet@example.com',
          name: 'Delete Wallet Customer',
        });

      customerId = customerResponse.body.id;

      // Note: In a real test, you'd create a wallet via payment completion
      // For this test, we'll assume wallet creation is tested separately
    });

    it('should return 404 when deleting nonexistent wallet', async () => {
      const fakeWalletId = '00000000-0000-0000-0000-000000000000';
      
      return request(app.getHttpServer())
        .delete(`/v1/customers/${customerId}/wallets/${fakeWalletId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
