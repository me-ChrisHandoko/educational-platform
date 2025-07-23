import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;
  private readonly counters: Map<string, Counter>;
  private readonly histograms: Map<string, Histogram>;
  private readonly gauges: Map<string, Gauge>;

  constructor() {
    this.registry = new Registry();
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();

    // Set default labels
    this.registry.setDefaultLabels({
      app: 'educational-platform',
    });

    // Initialize common metrics
    this.initializeMetrics();
  }

  private initializeMetrics() {
    // HTTP metrics
    this.createHistogram('http_request_duration_ms', 'HTTP request duration in milliseconds', ['method', 'route', 'status']);
    this.createCounter('http_requests_total', 'Total number of HTTP requests', ['method', 'route', 'status']);

    // Database metrics
    this.createHistogram('db_query_duration', 'Database query duration in milliseconds', ['operation', 'table']);
    this.createCounter('db_query_total', 'Total number of database queries', ['operation', 'table', 'status']);
    this.createCounter('db_connection_success', 'Successful database connections');
    this.createCounter('db_connection_failure', 'Failed database connections');
    this.createCounter('db_error', 'Database errors');
    this.createCounter('db_query_slow', 'Slow database queries');
    this.createHistogram('db_operation_duration', 'Database operation duration', ['model', 'action', 'error']);
    this.createCounter('db_transaction_success', 'Successful database transactions');
    this.createCounter('db_transaction_failure', 'Failed database transactions');
    this.createCounter('db_transaction_retry', 'Database transaction retries');
    this.createCounter('db_transaction_non_retryable_error', 'Non-retryable transaction errors');
    this.createHistogram('db_health_check_duration', 'Database health check duration');
    this.createCounter('db_health_check_failure', 'Database health check failures');
    this.createCounter('db_connection_disconnect', 'Database disconnections');

    // Auth metrics
    this.createHistogram('auth_login_duration', 'Login operation duration');
    this.createCounter('auth_login_success', 'Successful logins');
    this.createCounter('auth_login_error', 'Login errors');
    this.createCounter('auth_login_locked', 'Login attempts on locked accounts');
    this.createHistogram('auth_register_duration', 'Registration operation duration');
    this.createCounter('auth_register_success', 'Successful registrations');
    this.createCounter('auth_register_error', 'Registration errors');
    this.createCounter('auth_refresh_success', 'Successful token refreshes');
    this.createCounter('auth_refresh_error', 'Token refresh errors');
    this.createCounter('auth_password_change_success', 'Successful password changes');
    this.createCounter('auth_password_change_invalid_current', 'Password changes with invalid current password');

    // Cache metrics
    this.createCounter('cache_hit', 'Cache hits', ['key_type']);
    this.createCounter('cache_miss', 'Cache misses', ['key_type']);
    this.createCounter('cache_set', 'Cache sets', ['key_type']);
    this.createCounter('cache_delete', 'Cache deletes', ['key_type']);
    this.createGauge('cache_keys_total', 'Total number of keys in cache');

    // Business metrics
    this.createGauge('active_users', 'Number of active users');
    this.createGauge('active_sessions', 'Number of active sessions');
    this.createCounter('api_errors_total', 'Total API errors', ['error_type', 'endpoint']);
  }

  createCounter(name: string, help: string, labelNames: string[] = []): Counter {
    if (this.counters.has(name)) {
      return this.counters.get(name)!;
    }

    const counter = new Counter({
      name,
      help,
      labelNames,
      registers: [this.registry],
    });

    this.counters.set(name, counter);
    return counter;
  }

  createHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): Histogram {
    if (this.histograms.has(name)) {
      return this.histograms.get(name)!;
    }

    const histogram = new Histogram({
      name,
      help,
      labelNames,
      buckets: buckets || [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000],
      registers: [this.registry],
    });

    this.histograms.set(name, histogram);
    return histogram;
  }

  createGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    if (this.gauges.has(name)) {
      return this.gauges.get(name)!;
    }

    const gauge = new Gauge({
      name,
      help,
      labelNames,
      registers: [this.registry],
    });

    this.gauges.set(name, gauge);
    return gauge;
  }

  incrementCounter(name: string, labels?: Record<string, string | number>): void {
    const counter = this.counters.get(name);
    if (counter) {
      if (labels) {
        counter.labels(labels).inc();
      } else {
        counter.inc();
      }
    }
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string | number>): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      if (labels) {
        histogram.labels(labels).observe(value);
      } else {
        histogram.observe(value);
      }
    }
  }

  setGauge(name: string, value: number, labels?: Record<string, string | number>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.labels(labels).set(value);
      } else {
        gauge.set(value);
      }
    }
  }

  incrementGauge(name: string, value: number = 1, labels?: Record<string, string | number>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.labels(labels).inc(value);
      } else {
        gauge.inc(value);
      }
    }
  }

  decrementGauge(name: string, value: number = 1, labels?: Record<string, string | number>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.labels(labels).dec(value);
      } else {
        gauge.dec(value);
      }
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  recordRequest(duration: number, statusCode: number, method: string, route: string): void {
    const labels = {
      method,
      route,
      status: statusCode.toString(),
    };

    this.recordHistogram('http_request_duration_ms', duration, labels);
    this.incrementCounter('http_requests_total', labels);

    if (statusCode >= 400) {
      this.incrementCounter('api_errors_total', {
        error_type: statusCode >= 500 ? 'server_error' : 'client_error',
        endpoint: `${method} ${route}`,
      });
    }
  }

  reset(): void {
    this.registry.clear();
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.initializeMetrics();
  }
}
