import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { SecurityConfigService } from './common/services/security-config.service';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { MetricsService } from './common/services/metrics.service';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create Fastify adapter with options
  const fastifyAdapter = new FastifyAdapter({
    logger: false, // Use our custom logger
    trustProxy: true, // For proper IP detection behind proxies
    bodyLimit: 10485760, // 10MB
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: (req) => {
      return req.headers['x-request-id'] || require('uuid').v4();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      bufferLogs: true,
      abortOnError: false,
    },
  );

  const configService = app.get(ConfigService<AppConfig>);
  const securityConfigService = app.get(SecurityConfigService);
  const metricsService = app.get(MetricsService);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      validationError: {
        target: false,
        value: false,
      },
      stopAtFirstError: false,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter(metricsService, configService));

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(metricsService),
    new TransformInterceptor(),
  );

  // API prefix
  const apiPrefix = configService.get('app.apiPrefix', { infer: true }) || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // Security middleware
  if (process.env.NODE_ENV !== 'test') {
    // Helmet for security headers
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: true,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      dnsPrefetchControl: true,
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    });

    // Compression
    await app.register(compress, {
      encodings: ['gzip', 'deflate'],
      threshold: 1024,
    });

    // Rate limiting
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      errorResponseBuilder: () => {
        return {
          success: false,
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Rate limit exceeded, please try again later',
        };
      },
    });
  }

  // CORS configuration
  const corsConfig = securityConfigService.getCorsConfig();
  if (corsConfig) {
    app.enableCors(corsConfig);
  }

  // Swagger documentation
  if (configService.get('app.environment') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Educational Management Platform API')
      .setDescription('Comprehensive API for multi-tenant educational management system')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-Tenant-ID',
          in: 'header',
          description: 'Tenant identifier',
        },
        'tenant-id',
      )
      .addServer(
        configService.get('app.url') || 'http://localhost:3001',
        'Current Environment',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        `${controllerKey.replace('Controller', '')}_${methodKey}`,
      deepScanRoutes: true,
    });

    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
      customSiteTitle: 'Educational Platform API Docs',
    });
  }

  // Health check endpoint
  app.getHttpAdapter().get(`/${apiPrefix}/health`, (req, reply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Metrics endpoint
  app.getHttpAdapter().get(`/${apiPrefix}/metrics`, async (req, reply) => {
    reply.header('Content-Type', 'text/plain');
    const metrics = await metricsService.getMetrics();
    reply.send(metrics);
  });

  // Graceful shutdown
  const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.log(`${signal} received, starting graceful shutdown...`);
      
      try {
        // Stop accepting new requests
        await app.close();
        
        logger.log('Application closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  const port = configService.get('app.port', { infer: true }) || 3001;
  const host = configService.get('app.host', { infer: true }) || '0.0.0.0';
  const environment = configService.get('app.environment', { infer: true }) || 'development';

  await app.listen(port, host);

  logger.log(`🚀 Application is running on: http://${host}:${port}/${apiPrefix}`);
  logger.log(`📋 Health check available at: http://${host}:${port}/${apiPrefix}/health`);
  logger.log(`📊 Metrics available at: http://${host}:${port}/${apiPrefix}/metrics`);
  if (environment !== 'production') {
    logger.log(`📚 API Documentation available at: http://${host}:${port}/${apiPrefix}/docs`);
  }
  logger.log(`🔧 Environment: ${environment}`);
  logger.log(`🛡️ Security features enabled: CORS, Helmet, Rate Limiting, Validation`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error);
  process.exit(1);
});
