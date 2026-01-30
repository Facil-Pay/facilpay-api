import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('UsersModule (e2e)', () => {
  let app: INestApplication<App>;
  let jwtToken: string;
  let userId: string;

  const testUser = {
    email: 'test@example.com',
    password: 'password123',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/users (POST) - Create a user independently', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .send(testUser)
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe(testUser.email);
    expect(response.body).not.toHaveProperty('password');
    userId = response.body.id;
  });

  it('/auth/login (POST) - Login with created user', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(testUser)
      .expect(200);

    expect(response.body).toHaveProperty('access_token');
    jwtToken = response.body.access_token;
  });

  it('/users (GET) - Get all users (Protected)', async () => {
    const response = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('/users/:id (GET) - Get specific user (Protected)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    expect(response.body.id).toBe(userId);
    expect(response.body.email).toBe(testUser.email);
  });

  it('/users/:id (PATCH) - Update user (Protected)', async () => {
    const updateData = { email: 'updated@example.com' };
    const response = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .send(updateData)
      .expect(200);

    expect(response.body.email).toBe(updateData.email);
  });

  it('/users/:id (DELETE) - Delete user (Protected)', async () => {
    await request(app.getHttpServer())
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(200);

    // Verify deletion - Access with deleted user's token should fail (401)
    await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${jwtToken}`)
      .expect(401);
  });

  it('/users/:id (GET) - Get non-existent user (Protected)', async () => {
    // Create a new user to get a valid token
    const newUser = { email: 'temp@example.com', password: 'password' };
    await request(app.getHttpServer()).post('/users').send(newUser).expect(201);

    // Login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send(newUser)
      .expect(200);

    const token = loginRes.body.access_token;
    const fakeId = 'nonicon-existent-id';

    await request(app.getHttpServer())
      .get(`/users/${fakeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
