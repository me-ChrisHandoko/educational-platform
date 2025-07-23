export interface AppConfig {
  app: {
    name: string;
    version: string;
    environment: string;
    port: number;
    apiPrefix: string;
    host: string;
  };
  database: {
    url: string;
    poolSize: number;
    connectionTimeout: number;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  security: {
    argon2: {
      memoryCost: number;
      timeCost: number;
      parallelism: number;
    };
    cors: {
      enabled: boolean;
      origins: string[];
    };
    rateLimit: {
      ttl: number;
      limit: number;
    };
  };
  features: {
    swagger: boolean;
    metrics: boolean;
    healthCheck: boolean;
  };
  monitoring: {
    logLevel: string;
    sentryDsn?: string;
    metricsPort: number;
  };
}

export default (): AppConfig => ({
  app: {
    name: process.env.APP_NAME || 'Educational Platform API',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
    apiPrefix: process.env.API_PREFIX || 'api/v1',
    host: process.env.HOST || '0.0.0.0',
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://localhost:3479/educational_platform',
    poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
    connectionTimeout: parseInt(
      process.env.DATABASE_CONNECTION_TIMEOUT || '30000',
      10,
    ),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'your-access-secret-here',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-here',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  security: {
    argon2: {
      memoryCost: parseInt(process.env.ARGON2_MEMORY_COST || '65536', 10),
      timeCost: parseInt(process.env.ARGON2_TIME_COST || '3', 10),
      parallelism: parseInt(process.env.ARGON2_PARALLELISM || '1', 10),
    },
    cors: {
      enabled: process.env.ENABLE_CORS === 'true',
      origins: process.env.CORS_ORIGINS?.split(',') || [],
    },
    rateLimit: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
      limit: parseInt(process.env.RATE_LIMIT_LIMIT || '100', 10),
    },
  },
  features: {
    swagger: process.env.ENABLE_SWAGGER === 'true',
    metrics: process.env.ENABLE_METRICS === 'true',
    healthCheck: true, // Always enabled
  },
  monitoring: {
    logLevel: process.env.LOG_LEVEL || 'info',
    sentryDsn: process.env.SENTRY_DSN,
    metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),
  },
});
