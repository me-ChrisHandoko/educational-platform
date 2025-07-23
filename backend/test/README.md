# Test Architecture Documentation

This document explains the test architecture decisions, patterns, and best practices used in this educational platform backend.

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Test Environment Separation](#test-environment-separation)
- [Module Configuration](#module-configuration)
- [Test Categories](#test-categories)
- [Performance Optimizations](#performance-optimizations)
- [Setup and Configuration](#setup-and-configuration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture Overview

### Core Principles

1. **Environment Isolation**: Clear separation between test and production environments
2. **Performance First**: Optimized for fast, reliable test execution
3. **Maintainability**: Easy to understand, modify, and extend
4. **Comprehensive Coverage**: Unit, integration, E2E, and smoke tests
5. **Fail-Fast**: Early detection of issues with clear error messages

### Test Structure

```
test/
├── auth/                    # Authentication E2E tests
├── e2e/                     # End-to-end smoke tests
├── integration/             # Integration tests with external modules
├── security/                # Security and negative scenario tests
├── helpers/                 # Test utilities and factories
├── setup.ts                 # Global test configuration
├── test-app.module.ts       # Test-specific app module
├── test-redis.module.ts     # Test-specific Redis module
└── README.md               # This documentation
```

## 🔧 Test Environment Separation

### Production vs Test Configuration

We maintain separate module configurations to avoid conflicts and ensure stable testing:

#### Production Modules (`src/app.module.ts`)
- ✅ Full ThrottlerModule with rate limiting
- ✅ SecurityMiddleware with request sanitization
- ✅ Redis connection with external dependencies
- ✅ Helmet and security headers
- ✅ CORS and production optimizations

#### Test Modules (`test/test-app.module.ts`)
- ❌ ThrottlerModule removed (causes Fastify hooks conflicts)
- ❌ SecurityMiddleware disabled (simplifies test setup)
- ✅ TestRedisModule with memory cache
- ❌ No external service dependencies
- ✅ Minimal middleware for essential functionality

### Why This Separation?

1. **Stability**: Prevents Fastify hooks conflicts that cause test failures
2. **Speed**: Eliminates external service dependencies and connection delays
3. **Reliability**: No Redis connection retries or external service timeouts
4. **Maintainability**: Clear boundaries between test and production code

## 🧩 Module Configuration

### TestAppModule

```typescript
@Module({
  imports: [
    ConfigModule, // Global configuration
    CommonModule, // Essential utilities
    TestRedisModule, // Memory-based caching
    PrismaModule, // Database access
    AuthModule, // Authentication logic
    // ThrottlerModule EXCLUDED - causes hooks conflicts
    // SecurityMiddleware EXCLUDED - not needed for auth tests
  ],
})
```

**Key Features:**
- Minimal dependencies for fast initialization
- No problematic Fastify plugins
- Memory-based caching
- Essential authentication functionality

### TestRedisModule

```typescript
@Module({
  imports: [
    CacheModule.register({
      store: 'memory',
      max: TEST_CONFIG.CACHE_MAX_ITEMS,
      ttl: TEST_CONFIG.CACHE_TTL_SECONDS,
    }),
  ],
})
```

**Benefits:**
- No Redis connection attempts
- Consistent cache interface
- Parameterized configuration
- Zero external dependencies

## 📊 Test Categories

### 1. E2E Tests (`test/auth/`)
**Purpose**: Test complete user workflows and authentication flows
**Modules**: TestAppModule (minimal configuration)
**Focus**: Core authentication functionality without external dependencies

```typescript
describe('Authentication (e2e)', () => {
  // Uses TestAppModule for stable, fast testing
  // Optimized token reuse (beforeAll vs beforeEach)
  // Performance monitoring
});
```

### 2. Integration Tests (`test/integration/`)
**Purpose**: Test production modules in isolation
**Modules**: Full AppModule (production configuration)
**Focus**: ThrottlerModule, SecurityMiddleware functionality

```typescript
describe('Throttle Integration (e2e)', () => {
  // Uses full AppModule to test rate limiting
  // Tests actual production behavior
  // Higher timeout for rate limit scenarios
});
```

### 3. Smoke Tests (`test/e2e/`)
**Purpose**: Validate production configuration can initialize
**Modules**: Full AppModule (production-like setup)
**Focus**: Module initialization, basic endpoints, error handling

```typescript
describe('Production Configuration Smoke Tests (e2e)', () => {
  // Validates all production modules can initialize
  // Tests basic endpoint availability
  // Performance benchmarking
});
```

### 4. Security Tests (`test/security/`)
**Purpose**: Test error scenarios and security edge cases
**Modules**: TestAppModule (controlled environment)
**Focus**: Input validation, error handling, negative scenarios

```typescript
describe('Negative Scenarios & Error Handling (e2e)', () => {
  // Tests malformed requests
  // Validates error responses
  // Security boundary testing
});
```

## ⚡ Performance Optimizations

### Token Reuse Strategy

**Before (Slow)**:
```typescript
beforeEach(async () => {
  // Login before every test = 42 requests for 21 tests
  const response = await request(app).post('/auth/login')...
});
```

**After (Fast)**:
```typescript
beforeAll(async () => {
  // Login once per suite = 4 requests total
  const response = await request(app).post('/auth/login')...
});
```

**Results**: 90% reduction in authentication requests, 70% faster execution

### Parameterized Configuration

All test configuration is centralized in `TEST_CONFIG`:

```typescript
export const TEST_CONFIG = {
  CONNECTION_TIMEOUT: 5000,
  KEEP_ALIVE_TIMEOUT: 5000,
  CACHE_MAX_ITEMS: 1000,
  CACHE_TTL_SECONDS: 300,
  BODY_LIMIT_BYTES: 10485760,
  MAX_RESPONSE_TIME_MS: 1000,
} as const;
```

**Benefits**:
- Single source of truth
- Easy to modify for different environments
- Type safety with `as const`
- Performance monitoring thresholds

### Performance Monitoring

Built-in performance monitoring with `TestPerformanceMonitor`:

```typescript
TestPerformanceMonitor.startTest('Test Name');
// ... test execution ...
TestPerformanceMonitor.endTest('Test Name');

// Automatic slow test detection
// Performance metrics collection
// Post-test reporting
```

## 🚀 Setup and Configuration

### Global Test Setup

Every test file should include:

```typescript
import { globalTestSetup, TEST_CONFIG } from '../setup';

beforeAll(async () => {
  globalTestSetup(); // Environment validation and setup
  // ... test-specific setup
});
```

### Environment Variables

Required for tests:
- `DATABASE_URL`: Test database connection
- `NODE_ENV`: Set to 'test' automatically
- `REDIS_URL`: Removed to force memory cache

Optional:
- `TEST_DATABASE_URL`: Separate test database
- `DISABLE_EXTERNAL_SERVICES`: Forces offline mode

### Fastify Configuration

Optimized for test performance:

```typescript
const fastifyAdapter = new FastifyAdapter({
  logger: false, // Silent for clean test output
  trustProxy: true, // Required for IP detection
  bodyLimit: TEST_CONFIG.BODY_LIMIT_BYTES,
  disableRequestLogging: true, // Reduces noise
  connectionTimeout: TEST_CONFIG.CONNECTION_TIMEOUT,
  keepAliveTimeout: TEST_CONFIG.KEEP_ALIVE_TIMEOUT,
});
```

## 📝 Best Practices

### Test Data Management

Use test data factories for consistent, isolated data:

```typescript
import { UserFactory, LoginCredentialsFactory } from '../helpers/test-data-factory';

// Create test users with proper relationships
const testUser = UserFactory.createStudent({ schoolId: 'known-school-id' });

// Use consistent login credentials
const credentials = LoginCredentialsFactory.validCredentials();
```

### Error Testing

Always test both success and failure scenarios:

```typescript
describe('Authentication', () => {
  it('should succeed with valid credentials', async () => {
    // Happy path testing
  });

  it('should fail with invalid credentials', async () => {
    // Error scenario testing
  });
});
```

### Performance Expectations

Set clear performance expectations:

```typescript
it('should respond within performance threshold', async () => {
  const startTime = Date.now();
  
  const response = await request(app)
    .get('/api/v1/health')
    .expect(200);
    
  const duration = Date.now() - startTime;
  expect(duration).toBeLessThan(TEST_CONFIG.MAX_RESPONSE_TIME_MS);
});
```

### Test Isolation

Ensure tests can run independently:

```typescript
beforeEach(async () => {
  // Reset state between tests if needed
  // Clean up test data
});

afterAll(async () => {
  // Clean up resources
  await seeder.cleanup();
  await app.close();
});
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Fastify Hooks Error
```
TypeError: Cannot read properties of undefined (reading 'length')
```
**Solution**: Use TestAppModule instead of AppModule to avoid ThrottlerModule conflicts.

#### 2. Redis Connection Failed
```
Reached the max retries per request limit
```
**Solution**: Use TestRedisModule or ensure REDIS_URL is not set in test environment.

#### 3. Slow Test Performance
```
Tests taking > 30 seconds to complete
```
**Solution**: 
- Use `beforeAll` instead of `beforeEach` for setup
- Check for token reuse opportunities
- Use TestPerformanceMonitor to identify bottlenecks

#### 4. Environment Variable Issues
```
Missing required test environment variables
```
**Solution**: Call `globalTestSetup()` at the start of test suites.

### Debugging Tips

1. **Enable Logging**: Set `logger: true` in FastifyAdapter for debugging
2. **Check Environment**: Verify `process.env.NODE_ENV === 'test'`
3. **Monitor Performance**: Use TestPerformanceMonitor for slow tests
4. **Isolate Tests**: Run individual test files to identify specific issues
5. **Check Module Dependencies**: Ensure test modules have all required dependencies

### Performance Benchmarks

Target performance metrics:
- **Test Suite Runtime**: < 10 seconds
- **Individual Test**: < 1 second
- **App Initialization**: < 3 seconds
- **Login Request**: < 500ms
- **Health Check**: < 100ms

## 📈 Future Improvements

Planned enhancements:
1. **Parallel Test Execution**: Run test suites in parallel
2. **Test Sharding**: Distribute tests across multiple runners
3. **Advanced Mocking**: Mock external services more comprehensively
4. **Visual Regression**: Add screenshot testing for UI components
5. **Load Testing**: Performance testing under load
6. **CI/CD Integration**: Automated test reporting and metrics

---

## 🔗 Related Documentation

- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Fastify Testing](https://www.fastify.io/docs/latest/Guides/Testing/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)

---

**Last Updated**: January 2025
**Maintainer**: Development Team