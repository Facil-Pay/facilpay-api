# Testing

FacilPay uses Jest for both unit and end-to-end (e2e) tests. This guide explains how to run tests, write new ones, and understand our testing conventions.

## Test Types and Structure

### Unit Tests

Unit tests live alongside the source code they test with a `.spec.ts` suffix:

```
src/modules/invoices/
  ├── invoices.service.ts
  └── invoices.service.spec.ts
```

Unit tests focus on individual classes or functions in isolation, using mocks for dependencies. They should:
- Test business logic without external dependencies (databases, APIs, queues)
- Mock repositories, services, and external providers
- Run quickly (< 100ms per test)
- Be deterministic and not depend on timing or network

**Example:**
```typescript
describe('InvoicesService', () => {
  let service: InvoicesService;
  let repository: Repository<Invoice>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    repository = module.get<Repository<Invoice>>(getRepositoryToken(Invoice));
  });

  it('should mark invoice as uncollectible', async () => {
    const invoice = { id: '123', status: InvoiceStatus.OPEN };
    jest.spyOn(repository, 'findOne').mockResolvedValue(invoice as any);
    
    await service.markUncollectible('merchant-id', '123');
    
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InvoiceStatus.UNCOLLECTIBLE })
    );
  });
});
```

### End-to-End (e2e) Tests

E2e tests live in the `test/` directory at the project root with an `.e2e-spec.ts` suffix:

```
test/
  ├── invoices.e2e-spec.ts
  ├── payments.e2e-spec.ts
  └── users.e2e-spec.ts
```

E2e tests exercise complete API endpoints with real database connections but mocked external services. They should:
- Test full HTTP request/response cycles
- Use the test database (auto-created by `docker-compose.test.yml`)
- Mock external services (Stellar/Horizon, email, SMS)
- Test authentication, validation, and error responses
- Cover the happy path and key error cases per endpoint

**Example:**
```typescript
describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Authenticate to get token
    const response = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password' })
      .expect(200);
    
    authToken = response.body.accessToken;
  });

  it('POST /v1/invoices/:id/mark-uncollectible', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerEmail: 'buyer@example.com',
        currency: 'USD',
        dueDate: '2030-12-31',
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: '100.00' }],
      })
      .expect(201);

    return request(app.getHttpServer())
      .post(`/v1/invoices/${invoice.body.id}/mark-uncollectible`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('UNCOLLECTIBLE');
      });
  });
});
```

## Running Tests

### Unit Tests

Run all unit tests:
```bash
npm test
```

Run in watch mode (re-runs on file changes):
```bash
npm run test:watch
```

Run with coverage report:
```bash
npm run test:cov
```

Coverage threshold is currently set at 1% (see `jest.config.js`). This low threshold is intentional as the test suite matures.

### End-to-End Tests

**Local (with Docker):**
```bash
docker compose -f docker-compose.test.yml run --rm api test:e2e
```

This command:
1. Builds the API container from `Dockerfile`
2. Starts a PostgreSQL 16 container with an in-memory database (tmpfs)
3. Runs the e2e test suite against the test database
4. Cleans up containers after tests complete

The test database is ephemeral and discarded after each run.

**Inside a running container:**
```bash
npm run test:e2e
```

### Configuration Files

- **jest.config.js** — Unit test configuration
  - Test pattern: `*.spec.ts`
  - Root directory: `src/`
  - Transform: `ts-jest`
  - Coverage threshold: 1%

- **test/jest-e2e.json** — E2e test configuration
  - Test pattern: `*.e2e-spec.ts`
  - Root directory: `test/`

## Mocking External Services

### Database

- **Unit tests**: Mock TypeORM repositories using `getRepositoryToken()` and Jest mocks
- **E2e tests**: Use real PostgreSQL test database with `DATABASE_SYNCHRONIZE=true` (auto-creates schema)

### Stellar/Horizon

The Stellar SDK is mocked to avoid hitting the real testnet during tests. Mock account creation, transaction submission, and payment streams:

```typescript
jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    random: jest.fn(() => ({
      publicKey: jest.fn(() => 'MOCK_PUBLIC_KEY'),
      secret: jest.fn(() => 'MOCK_SECRET_KEY'),
    })),
  },
  Server: jest.fn(() => ({
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  })),
}));
```

### Email

The `EmailService` is mocked in e2e tests to prevent sending real emails:

```typescript
const mockEmailService = {
  sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
};
```

For unit tests of notification services, mock the entire `EmailNotificationService`.

### SMS

The SMS provider is swappable via the `SMS_PROVIDER` environment variable. Use `SMS_PROVIDER=mock` for tests to avoid sending real SMS messages.

### Queues (BullMQ)

Mock queue processors in unit tests:

```typescript
const mockQueue = {
  add: jest.fn(),
  process: jest.fn(),
};
```

E2e tests can use real Redis queues with the in-memory mode or mock them depending on the scenario.

## Writing Tests

### Naming Conventions

- **Test files**: Match the source file name with `.spec.ts` (unit) or `.e2e-spec.ts` (e2e)
- **Describe blocks**: Use the class or endpoint name
- **Test names**: Start with "should" and describe the expected behavior

```typescript
describe('InvoicesService', () => {
  it('should mark overdue invoices automatically', async () => {
    // ...
  });
});

describe('POST /v1/invoices/:id/mark-uncollectible', () => {
  it('should return 401 without authentication', async () => {
    // ...
  });
});
```

### Assertions

Use Jest matchers:
- `expect(value).toBe(expected)` — strict equality
- `expect(value).toEqual(expected)` — deep equality
- `expect(fn).toThrow(ErrorClass)` — error throwing
- `expect(mock).toHaveBeenCalledWith(arg1, arg2)` — mock calls

### Test Data

Use factories or helper functions for consistent test data:

```typescript
const makeInvoice = (overrides = {}) => ({
  id: 'invoice-123',
  merchantId: 'merchant-456',
  status: InvoiceStatus.OPEN,
  total: '100.00',
  ...overrides,
});
```

### Authentication in E2e Tests

Most endpoints require authentication. Create a helper to log in and retrieve tokens:

```typescript
async function authenticate(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.accessToken;
}
```

Use the token in subsequent requests:
```typescript
await request(app.getHttpServer())
  .get('/v1/invoices')
  .set('Authorization', `Bearer ${token}`)
  .expect(200);
```

## Coverage Expectations

The current coverage threshold is intentionally low (1%) while the suite is being built out. As features stabilize, contributors should:
- Aim for >80% line coverage on new services and controllers
- Test both success and error paths
- Cover edge cases (empty lists, invalid inputs, permission checks)

To view coverage:
```bash
npm run test:cov
open coverage/lcov-report/index.html
```

## CI Pipeline

GitHub Actions runs tests on every pull request (see `.github/workflows/ci.yml`):
1. Install dependencies
2. Run linter
3. Run unit tests with coverage
4. Run e2e tests in Docker
5. Fail the build if any test fails

## Tips

- **Focus tests**: Use `.only` to run a single test during development:
  ```typescript
  it.only('should do something', () => { ... });
  ```
- **Skip tests**: Use `.skip` to temporarily disable a test:
  ```typescript
  it.skip('should do something else', () => { ... });
  ```
- **Debugging**: Run tests in debug mode with breakpoints:
  ```bash
  npm run test:debug
  ```
- **Isolation**: Each test should be independent. Avoid shared state between tests.
- **Cleanup**: Use `afterEach` or `afterAll` to clean up resources (close connections, clear mocks).

## Example: Full E2e Test

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const auth = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'merchant@example.com', password: 'SecurePass123!' })
      .expect(201);
    token = auth.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/invoices creates a draft invoice', async () => {
    return request(app.getHttpServer())
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerEmail: 'buyer@example.com',
        customerName: 'Buyer Name',
        currency: 'USD',
        dueDate: '2030-12-31',
        lineItems: [
          { description: 'Consulting', quantity: 5, unitPrice: '100.00' },
        ],
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('DRAFT');
        expect(res.body.total).toBe('500.00');
      });
  });
});
```

## Questions?

For questions about testing patterns, ask in the team chat or refer to existing e2e tests in the `test/` directory as examples.
