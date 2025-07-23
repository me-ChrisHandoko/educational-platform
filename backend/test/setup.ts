/**
 * Global test setup and environment validation
 * Ensures consistent test environment across all test suites
 */

// Validate and set test environment variables
export function setupTestEnvironment() {
  // Force test environment
  process.env.NODE_ENV = 'test';
  
  // Disable Redis connection attempts
  delete process.env.REDIS_URL;
  
  // Set test-specific configurations
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  
  // Disable external service connections
  process.env.DISABLE_EXTERNAL_SERVICES = 'true';
  
  // Set consistent timezone for tests
  process.env.TZ = 'UTC';
  
  // Validate required test environment variables
  const requiredVars = ['DATABASE_URL'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required test environment variables: ${missingVars.join(', ')}`);
  }
  
  console.log('✅ Test environment setup complete');
}

// Test configuration constants
export const TEST_CONFIG = {
  // Connection timeouts
  CONNECTION_TIMEOUT: 5000,
  KEEP_ALIVE_TIMEOUT: 5000,
  
  // Cache settings
  CACHE_MAX_ITEMS: 1000,
  CACHE_TTL_SECONDS: 300,
  
  // Request limits
  BODY_LIMIT_BYTES: 10485760, // 10MB
  
  // Test data limits
  MAX_TEST_USERS: 10,
  MAX_LOGIN_ATTEMPTS: 5,
  
  // Performance thresholds
  MAX_RESPONSE_TIME_MS: 1000,
  MAX_TEST_DURATION_MS: 30000,
} as const;

// Performance monitoring for tests
export class TestPerformanceMonitor {
  private static startTime: number;
  private static metrics: Array<{ name: string; duration: number }> = [];
  
  static startTest(testName: string) {
    this.startTime = Date.now();
    console.log(`⏱️  Starting test: ${testName}`);
  }
  
  static endTest(testName: string) {
    const duration = Date.now() - this.startTime;
    this.metrics.push({ name: testName, duration });
    
    if (duration > TEST_CONFIG.MAX_RESPONSE_TIME_MS) {
      console.warn(`⚠️  Slow test detected: ${testName} (${duration}ms)`);
    }
    
    console.log(`✅ Test completed: ${testName} (${duration}ms)`);
  }
  
  static getMetrics() {
    return [...this.metrics];
  }
  
  static reset() {
    this.metrics = [];
  }
}

// Setup function to be called before all tests
export function globalTestSetup() {
  setupTestEnvironment();
  TestPerformanceMonitor.reset();
}