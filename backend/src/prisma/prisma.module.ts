import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MetricsService } from '../common/services/metrics.service';

@Global()
@Module({
  providers: [PrismaService, MetricsService],
  exports: [PrismaService],
})
export class PrismaModule {}
