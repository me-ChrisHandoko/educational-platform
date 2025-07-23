import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { HealthModule } from '../health/health.module';

@Module({
  imports: [HealthModule],
  controllers: [MonitoringController],
})
export class MonitoringModule {}
