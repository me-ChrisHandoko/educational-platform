import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().port().default(3001),
  API_PREFIX: Joi.string().default('api/v1'),
  HOST: Joi.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT: Joi.number().integer().min(1000).default(30000),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Security
  ARGON2_MEMORY_COST: Joi.number().integer().min(1024).default(65536),
  ARGON2_TIME_COST: Joi.number().integer().min(1).default(3),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(1),

  // CORS
  ENABLE_CORS: Joi.boolean().default(true),
  CORS_ORIGINS: Joi.string().optional(),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_LIMIT: Joi.number().integer().min(1).default(100),

  // Features
  ENABLE_SWAGGER: Joi.boolean().default(false),
  ENABLE_METRICS: Joi.boolean().default(true),

  // Monitoring
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  METRICS_PORT: Joi.number().port().default(9090),

  // Testing (optional)
  TEST_DATABASE_URL: Joi.string().uri().optional(),
  TEST_TIMEOUT: Joi.number().integer().default(30000),
  TEST_PARALLEL_WORKERS: Joi.number().integer().default(1),

  // Session & Redis Configuration
  SESSION_SECRET: Joi.string().optional(),
  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
  REDIS_DEFAULT_TTL: Joi.number().integer().min(1).default(300), // 5 minutes
  REDIS_MAX_RETRIES: Joi.number().integer().min(0).default(3),
  REDIS_CONNECT_TIMEOUT: Joi.number().integer().min(1000).default(10000),

  // Email Configuration (optional for future use)
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),

  // Application Name
  APP_NAME: Joi.string().optional(),
});
