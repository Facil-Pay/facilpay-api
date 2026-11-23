import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestLog } from './request-log.entity';
import { RequestLogsService } from './request-logs.service';
import { RequestLogsController } from './request-logs.controller';
import { RequestLogsMiddleware } from './request-logs.middleware';
@Module({ imports: [TypeOrmModule.forFeature([RequestLog])], controllers: [RequestLogsController], providers: [RequestLogsService, RequestLogsMiddleware] })
export class RequestLogsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(RequestLogsMiddleware).forRoutes('*'); }
}
