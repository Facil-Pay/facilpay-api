import { Global, Module } from '@nestjs/common';
import { CorsConfigService } from './cors-config.service';

@Global()
@Module({
  providers: [CorsConfigService],
  exports: [CorsConfigService],
})
export class CorsModule {}
