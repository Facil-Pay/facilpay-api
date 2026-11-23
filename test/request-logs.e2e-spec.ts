import { Controller, INestApplication, Post, Req, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { RequestLogsController } from '../src/modules/request-logs/request-logs.controller';
import { RequestLogsService } from '../src/modules/request-logs/request-logs.service';
import { RequestLogsMiddleware } from '../src/modules/request-logs/request-logs.middleware';
import { RequestLog } from '../src/modules/request-logs/request-log.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { SecurityStore } from './helpers/security-store';

const owner = '11111111-1111-4111-8111-111111111111';
@Controller('v1/test-integration')
class IntegrationController {
  @Post() create(@Req() req: any) { req.apiKey = { id: '22222222-2222-4222-8222-222222222222', userId: owner }; return { status: 'created', password: 'response-secret', amount: 42 }; }
}
describe('Request log endpoints (HTTP)', () => {
  let app: INestApplication, db: SecurityStore, logs: RequestLogsService;
  beforeEach(async () => {
    db = new SecurityStore();
    const repo = db.getRepository(RequestLog);
    repo.createQueryBuilder = () => {
      const predicates: Array<(row: any) => boolean> = []; let offset = 0, size = 20;
      const builder: any = {
        where: (sql: string, params: any) => builder.andWhere(sql, params),
        andWhere: (sql: string, params: any) => {
          const match = /log\.(\w+) (>=|<=|=) :(\w+)/.exec(sql)!;
          predicates.push(row => match[2] === '=' ? row[match[1]] === params[match[3]] : match[2] === '>=' ? row[match[1]] >= params[match[3]] : row[match[1]] <= params[match[3]]);
          return builder;
        },
        orderBy: () => builder, addOrderBy: () => builder,
        skip: value => { offset = value; return builder; }, take: value => { size = value; return builder; },
        getManyAndCount: async () => { const rows = db.rows(RequestLog).filter(row => predicates.every(predicate => predicate(row))); return [rows.slice(offset, offset + size), rows.length]; },
      }; return builder;
    };
    const module = await Test.createTestingModule({ controllers: [RequestLogsController, IntegrationController], providers: [RequestLogsService,
      { provide: getRepositoryToken(RequestLog), useValue: repo },
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: context => {
      const req = context.switchToHttp().getRequest();
      if (!req.headers.authorization) return false;
      req.user = { id: req.headers.authorization === 'Bearer other' ? 'other' : owner }; return true;
    } }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    logs = module.get(RequestLogsService);
    const middleware = new RequestLogsMiddleware(logs); app.use(middleware.use.bind(middleware));
    await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('captures asynchronously, redacts request/response, and supports list/detail filters', async () => {
    await request(app.getHttpServer()).post('/v1/test-integration?token=query-secret').set('Idempotency-Key', 'retry-1').send({ password: 'request-secret', nested: { token: 'nested-secret' } }).expect(201);
    await new Promise<void>(resolve => setImmediate(resolve));
    const list = await request(app.getHttpServer()).get('/v1/request-logs?method=POST&status=201&idempotencyKey=retry-1').set('Authorization', 'Bearer owner').expect(200);
    expect(list.body.total).toBe(1);
    const log = list.body.data[0];
    expect(JSON.stringify(log)).not.toMatch(/request-secret|response-secret|nested-secret|query-secret/);
    expect(log.path).toBe('/v1/test-integration');
    expect(log.requestBody.password).toBe('[REDACTED]');
    await request(app.getHttpServer()).get('/v1/request-logs/' + log.id).set('Authorization', 'Bearer owner').expect(200);
    await request(app.getHttpServer()).get('/v1/request-logs/' + log.id).set('Authorization', 'Bearer other').expect(404);
    const other = await request(app.getHttpServer()).get('/v1/request-logs').set('Authorization', 'Bearer other').expect(200);
    expect(other.body.total).toBe(0);
  });
  it('validates filters and hides retained-but-expired records', async () => {
    await request(app.getHttpServer()).get('/v1/request-logs?limit=101').set('Authorization', 'Bearer owner').expect(400);
    await logs.persist({ merchantId: owner, apiKeyId: owner, method: 'GET', path: '/v1/test', status: 200, latencyMs: 1, createdAt: new Date(Date.now() - 31 * 86400000) });
    const id = db.rows(RequestLog)[0].id;
    await request(app.getHttpServer()).get('/v1/request-logs/' + id).set('Authorization', 'Bearer owner').expect(404);
    await logs.prune(); expect(db.rows(RequestLog)).toHaveLength(0);
  });
});
