import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { MetricsService } from '../common/services/metrics.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);
  private connectionRetries = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 1000; // Start with 1 second
  private isShuttingDown = false;

  constructor(
    private configService: ConfigService,
    private metricsService: MetricsService,
  ) {
    const databaseUrl = configService.get<string>('DATABASE_URL');
    
    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: [
        { level: 'query', emit: 'event' },
        { level: 'info', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
      errorFormat: 'pretty',
    });

    this.setupLogging();
    this.setupMetrics();
  }

  private setupLogging() {
    // Query logging
    this.$on('query' as any, (e: any) => {
      if (this.configService.get('NODE_ENV') === 'development') {
        this.logger.debug(`Query: ${e.query} - Params: ${e.params} - Duration: ${e.duration}ms`);
      }
      
      // Record query metrics
      this.metricsService.recordHistogram('db.query.duration', e.duration);
      
      // Log slow queries
      if (e.duration > 1000) {
        this.logger.warn(`Slow query detected (${e.duration}ms): ${e.query}`);
        this.metricsService.incrementCounter('db.query.slow');
      }
    });

    // Info logging
    this.$on('info' as any, (e: any) => {
      this.logger.log(e.message);
    });

    // Warning logging
    this.$on('warn' as any, (e: any) => {
      this.logger.warn(e.message);
    });

    // Error logging
    this.$on('error' as any, (e: any) => {
      this.logger.error(e.message);
      this.metricsService.incrementCounter('db.error');
    });
  }

  private setupMetrics() {
    // Setup middleware for metrics
    this.$use(async (params, next) => {
      const startTime = Date.now();
      
      try {
        const result = await next(params);
        const duration = Date.now() - startTime;
        
        this.metricsService.recordHistogram(
          'db.operation.duration',
          duration,
          {
            model: params.model,
            action: params.action,
          },
        );
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.metricsService.recordHistogram(
          'db.operation.duration',
          duration,
          {
            model: params.model,
            action: params.action,
            error: 'true',
          },
        );
        
        throw error;
      }
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    while (this.connectionRetries < this.maxRetries && !this.isShuttingDown) {
      try {
        await this.$connect();
        this.logger.log('Successfully connected to database');

        // Verify database connection with a simple query
        await this.$queryRaw`SELECT 1`;
        this.logger.log('Database connection verified');
        
        // Reset retry counter on successful connection
        this.connectionRetries = 0;
        
        // Record successful connection
        this.metricsService.incrementCounter('db.connection.success');
        
        return;
      } catch (error) {
        this.connectionRetries++;
        
        if (this.connectionRetries >= this.maxRetries) {
          this.logger.error(
            `Failed to connect to database after ${this.maxRetries} attempts`,
            error,
          );
          this.metricsService.incrementCounter('db.connection.failure');
          throw error;
        }

        const delay = this.retryDelay * Math.pow(2, this.connectionRetries - 1);
        this.logger.warn(
          `Database connection attempt ${this.connectionRetries} failed, retrying in ${delay}ms...`,
          error.message,
        );
        
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    await this.disconnect();
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Application shutting down (${signal})`);
    this.isShuttingDown = true;
    await this.disconnect();
  }

  private async disconnect() {
    try {
      await this.$disconnect();
      this.logger.log('Disconnected from database');
      this.metricsService.incrementCounter('db.connection.disconnect');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error);
    }
  }

  // Helper method for transactions with retry logic
  async executeInTransaction<T>(
    fn: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>) => Promise<T>,
    options?: {
      maxRetries?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3;
    const timeout = options?.timeout ?? 10000;
    const isolationLevel = options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted;
    
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const result = await this.$transaction(fn, {
          timeout,
          isolationLevel,
        });
        
        this.metricsService.incrementCounter('db.transaction.success');
        return result;
      } catch (error) {
        attempt++;

        if (attempt >= maxRetries) {
          this.logger.error(
            `Transaction failed after ${maxRetries} attempts`,
            error,
          );
          this.metricsService.incrementCounter('db.transaction.failure');
          throw error;
        }

        // Check if the error is retryable
        if (!this.isRetryableError(error)) {
          this.metricsService.incrementCounter('db.transaction.non_retryable_error');
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));

        this.logger.warn(
          `Transaction attempt ${attempt} failed, retrying in ${delay}ms`,
          error.message,
        );
        this.metricsService.incrementCounter('db.transaction.retry');
      }
    }

    throw new Error('Transaction retry logic failed');
  }

  private isRetryableError(error: any): boolean {
    // Prisma error codes that are retryable
    const retryableErrorCodes = [
      'P1001', // Can't reach database server
      'P1002', // Database server timeout
      'P2024', // Connection pool timeout
      'P2034', // Transaction conflict
    ];

    if (error.code && retryableErrorCodes.includes(error.code)) {
      return true;
    }

    // Check for common retryable database errors
    const errorMessage = error.message?.toLowerCase() || '';
    const retryablePatterns = [
      'deadlock',
      'timeout',
      'connection',
      'pool',
      'conflict',
    ];

    return retryablePatterns.some((pattern) => errorMessage.includes(pattern));
  }

  // Health check method
  async isHealthy(): Promise<boolean> {
    try {
      const startTime = Date.now();
      await this.$queryRaw`SELECT 1`;
      const duration = Date.now() - startTime;
      
      this.metricsService.recordHistogram('db.health_check.duration', duration);
      
      // Consider unhealthy if query takes too long
      if (duration > 1000) {
        this.logger.warn(`Database health check slow: ${duration}ms`);
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error);
      this.metricsService.incrementCounter('db.health_check.failure');
      return false;
    }
  }

  // Get database metrics
  async getMetrics(): Promise<{
    activeConnections: number;
    totalConnections: number;
    idleConnections: number;
    waitingConnections: number;
    databaseSize: string;
    tableStats: Array<{
      tableName: string;
      rowCount: number;
      size: string;
    }>;
  }> {
    try {
      // Get connection stats
      const [connectionStats] = await this.$queryRaw<
        Array<{
          active: bigint;
          total: bigint;
          idle: bigint;
          waiting: bigint;
        }>
      >`
        SELECT 
          COUNT(*) FILTER (WHERE state = 'active') as active,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE state = 'idle') as idle,
          COUNT(*) FILTER (WHERE wait_event_type = 'Client') as waiting
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `;

      // Get database size
      const [dbSize] = await this.$queryRaw<
        Array<{ size: string }>
      >`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `;

      // Get table statistics
      const tableStats = await this.$queryRaw<
        Array<{
          tableName: string;
          rowCount: bigint;
          size: string;
        }>
      >`
        SELECT 
          schemaname || '.' || tablename as "tableName",
          n_live_tup as "rowCount",
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 10
      `;

      return {
        activeConnections: Number(connectionStats.active) || 0,
        totalConnections: Number(connectionStats.total) || 0,
        idleConnections: Number(connectionStats.idle) || 0,
        waitingConnections: Number(connectionStats.waiting) || 0,
        databaseSize: dbSize.size,
        tableStats: tableStats.map((stat) => ({
          tableName: stat.tableName,
          rowCount: Number(stat.rowCount),
          size: stat.size,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get database metrics', error);
      return {
        activeConnections: 0,
        totalConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        databaseSize: 'Unknown',
        tableStats: [],
      };
    }
  }

  // Optimized query methods
  async findManyWithCursor<T>(
    model: string,
    {
      where,
      orderBy,
      take = 50,
      cursor,
      include,
      select,
    }: {
      where?: any;
      orderBy?: any;
      take?: number;
      cursor?: any;
      include?: any;
      select?: any;
    },
  ): Promise<T[]> {
    const queryArgs: any = {
      where,
      orderBy,
      take: Math.min(take, 100), // Limit max items per request
    };

    if (cursor) {
      queryArgs.cursor = cursor;
      queryArgs.skip = 1; // Skip the cursor item
    }

    if (include) {
      queryArgs.include = include;
    } else if (select) {
      queryArgs.select = select;
    }

    return (this as any)[model].findMany(queryArgs);
  }

  // Batch operations
  async batchCreate<T>(
    model: string,
    data: any[],
    batchSize = 100,
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        const batchResults = await (this as any)[model].createMany({
          data: batch,
          skipDuplicates: true,
        });
        
        results.push(...batchResults);
        
        this.logger.debug(
          `Batch created ${batchResults.count} ${model} records (batch ${Math.floor(i / batchSize) + 1})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create batch ${Math.floor(i / batchSize) + 1} for ${model}`,
          error,
        );
        throw error;
      }
    }
    
    return results;
  }

  // Clean database for testing
  async cleanDb() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production');
    }

    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations')
      .map((name) => `"public"."${name}"`)
      .join(', ');

    try {
      await this.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
      this.logger.log('Database cleaned successfully');
    } catch (error) {
      this.logger.error('Error cleaning database', error);
      throw error;
    }
  }

  // Multi-tenant query helper
  async queryWithTenant<T>(
    tenantId: string,
    queryFn: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    // Set the search path to tenant schema
    await this.$executeRawUnsafe(
      `SET search_path TO tenant_${tenantId}, public`,
    );

    try {
      const result = await queryFn(this);
      
      // Reset search path
      await this.$executeRawUnsafe('SET search_path TO public');
      
      return result;
    } catch (error) {
      // Always reset search path even on error
      await this.$executeRawUnsafe('SET search_path TO public');
      throw error;
    }
  }
}
