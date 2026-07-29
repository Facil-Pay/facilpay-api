import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'];

    if (!idempotencyKey) {
      return next.handle();
    }

    const cachedResponse = await this.idempotencyService.checkOrClaimKey(
      idempotencyKey,
      request.body,
    );

    if (cachedResponse !== null) {
      return of(cachedResponse);
    }

    return next.handle().pipe(
      tap({
        next: async (response) => {
          await this.idempotencyService.updateResponse(
            idempotencyKey,
            response,
          );
        },
        error: async (err) => {
          await this.idempotencyService.deleteKey(idempotencyKey);
        },
      }),
    );
  }
}
