import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from './metrics.service';

export interface PerformanceThresholds {
  api: {
    fast: number; // < 100ms
    acceptable: number; // < 500ms
    slow: number; // < 2000ms
    // > slow = critical
  };
  database: {
    fast: number; // < 50ms
    acceptable: number; // < 200ms
    slow: number; // < 1000ms
    // > slow = critical
  };
  cache: {
    fast: number; // < 10ms
    acceptable: number; // < 50ms
    slow: number; // < 100ms
    // > slow = critical
  };
}

export interface PerformanceAlert {
  type: 'api' | 'database' | 'cache' | 'memory' | 'cpu';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  details?: Record<string, any>;
}

export interface PerformanceReport {
  period: string;
  summary: {
    totalRequests: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    errorRate: number;
    slowRequestsCount: number;
  };
  api: {
    fastRequests: number;
    acceptableRequests: number;
    slowRequests: number;
    criticalRequests: number;
  };
  database: {
    fastQueries: number;
    acceptableQueries: number;
    slowQueries: number;
    criticalQueries: number;
    averageQueryTime: number;
  };
  alerts: PerformanceAlert[];
  recommendations: string[];
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private readonly responseTimes: number[] = [];
  private readonly queryTimes: number[] = [];
  private readonly alerts: PerformanceAlert[] = [];
  private readonly maxHistorySize = 10000;

  private readonly thresholds: PerformanceThresholds = {
    api: {
      fast: 100,
      acceptable: 500,
      slow: 2000,
    },
    database: {
      fast: 50,
      acceptable: 200,
      slow: 1000,
    },
    cache: {
      fast: 10,
      acceptable: 50,
      slow: 100,
    },
  };

  constructor(private metricsService: MetricsService) {
    // Generate performance reports every hour
    setInterval(() => this.generateHourlyReport(), 60 * 60 * 1000);
  }

  /**
   * Record API response time and analyze performance
   */
  recordApiResponse(
    responseTime: number,
    route: string,
    method: string,
    statusCode: number,
  ): void {
    this.responseTimes.push(responseTime);
    this.limitHistorySize(this.responseTimes);

    // Check for performance issues
    this.checkApiPerformance(responseTime, route, method, statusCode);

    // Record detailed metrics
    this.metricsService.recordMetric({
      name: 'api_performance_category',
      value: 1,
      type: 'counter',
      tags: {
        category: this.categorizeResponseTime(responseTime, 'api'),
        route,
        method,
        status_code: statusCode.toString(),
      },
    });
  }

  /**
   * Record database query time and analyze performance
   */
  recordDatabaseQuery(
    queryTime: number,
    operation: string,
    table: string,
    success: boolean,
  ): void {
    this.queryTimes.push(queryTime);
    this.limitHistorySize(this.queryTimes);

    // Check for performance issues
    this.checkDatabasePerformance(queryTime, operation, table, success);

    // Record detailed metrics
    this.metricsService.recordMetric({
      name: 'database_performance_category',
      value: 1,
      type: 'counter',
      tags: {
        category: this.categorizeResponseTime(queryTime, 'database'),
        operation,
        table,
        success: success.toString(),
      },
    });
  }

  /**
   * Record memory usage and check for issues
   */
  recordMemoryUsage(): void {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const usagePercent = (heapUsedMB / heapTotalMB) * 100;

    // Check for memory issues
    if (usagePercent > 90) {
      this.addAlert({
        type: 'memory',
        severity: 'critical',
        message: 'Memory usage critically high',
        value: usagePercent,
        threshold: 90,
        timestamp: new Date(),
        details: {
          heapUsed: `${heapUsedMB.toFixed(2)}MB`,
          heapTotal: `${heapTotalMB.toFixed(2)}MB`,
        },
      });
    } else if (usagePercent > 80) {
      this.addAlert({
        type: 'memory',
        severity: 'warning',
        message: 'Memory usage high',
        value: usagePercent,
        threshold: 80,
        timestamp: new Date(),
        details: {
          heapUsed: `${heapUsedMB.toFixed(2)}MB`,
          heapTotal: `${heapTotalMB.toFixed(2)}MB`,
        },
      });
    }

    this.metricsService.recordMetric({
      name: 'memory_usage_percent',
      value: usagePercent,
      type: 'gauge',
    });
  }

  /**
   * Get current performance statistics
   */
  getPerformanceStats() {
    const recentResponses = this.responseTimes.slice(-1000); // Last 1000 requests
    const recentQueries = this.queryTimes.slice(-1000); // Last 1000 queries

    return {
      api: {
        averageResponseTime: this.average(recentResponses),
        p95ResponseTime: this.percentile(recentResponses, 95),
        p99ResponseTime: this.percentile(recentResponses, 99),
        totalSamples: recentResponses.length,
        distribution: this.getDistribution(recentResponses, 'api'),
      },
      database: {
        averageQueryTime: this.average(recentQueries),
        p95QueryTime: this.percentile(recentQueries, 95),
        p99QueryTime: this.percentile(recentQueries, 99),
        totalSamples: recentQueries.length,
        distribution: this.getDistribution(recentQueries, 'database'),
      },
      memory: process.memoryUsage(),
      alerts: this.getRecentAlerts(24), // Last 24 hours
    };
  }

  /**
   * Generate performance report for a specific period
   */
  generatePerformanceReport(hours: number = 1): PerformanceReport {
    const recentResponses = this.responseTimes.slice(
      -Math.min(this.responseTimes.length, hours * 1000),
    );
    const recentQueries = this.queryTimes.slice(
      -Math.min(this.queryTimes.length, hours * 1000),
    );
    const requestStats = this.metricsService.getRequestStats();

    const apiDistribution = this.getDistribution(recentResponses, 'api') as {
      fastRequests: number;
      acceptableRequests: number;
      slowRequests: number;
      criticalRequests: number;
    };
    const dbDistribution = this.getDistribution(recentQueries, 'database') as {
      fastQueries: number;
      acceptableQueries: number;
      slowQueries: number;
      criticalQueries: number;
    };

    return {
      period: `Last ${hours} hour(s)`,
      summary: {
        totalRequests: requestStats.totalRequests,
        averageResponseTime: this.average(recentResponses),
        p95ResponseTime: this.percentile(recentResponses, 95),
        errorRate: requestStats.errorRate,
        slowRequestsCount:
          apiDistribution.slowRequests + apiDistribution.criticalRequests,
      },
      api: apiDistribution,
      database: {
        ...dbDistribution,
        averageQueryTime: this.average(recentQueries),
      },
      alerts: this.getRecentAlerts(hours),
      recommendations: this.generateRecommendations(
        apiDistribution,
        dbDistribution,
      ),
    };
  }

  /**
   * Get performance thresholds
   */
  getThresholds(): PerformanceThresholds {
    return this.thresholds;
  }

  /**
   * Clear performance history (for testing)
   */
  clearHistory(): void {
    this.responseTimes.length = 0;
    this.queryTimes.length = 0;
    this.alerts.length = 0;
  }

  private checkApiPerformance(
    responseTime: number,
    route: string,
    method: string,
    statusCode: number,
  ): void {
    if (responseTime > this.thresholds.api.slow) {
      this.addAlert({
        type: 'api',
        severity: responseTime > 5000 ? 'critical' : 'warning',
        message: `Slow API response: ${method} ${route}`,
        value: responseTime,
        threshold: this.thresholds.api.slow,
        timestamp: new Date(),
        details: {
          route,
          method,
          statusCode,
        },
      });
    }
  }

  private checkDatabasePerformance(
    queryTime: number,
    operation: string,
    table: string,
    success: boolean,
  ): void {
    if (queryTime > this.thresholds.database.slow) {
      this.addAlert({
        type: 'database',
        severity: queryTime > 2000 ? 'critical' : 'warning',
        message: `Slow database query: ${operation} on ${table}`,
        value: queryTime,
        threshold: this.thresholds.database.slow,
        timestamp: new Date(),
        details: {
          operation,
          table,
          success,
        },
      });
    }
  }

  private categorizeResponseTime(
    time: number,
    type: 'api' | 'database' | 'cache',
  ): string {
    const thresholds = this.thresholds[type];

    if (time < thresholds.fast) return 'fast';
    if (time < thresholds.acceptable) return 'acceptable';
    if (time < thresholds.slow) return 'slow';
    return 'critical';
  }

  private getDistribution(times: number[], type: 'api' | 'database' | 'cache') {
    const distribution = { fast: 0, acceptable: 0, slow: 0, critical: 0 };

    for (const time of times) {
      const category = this.categorizeResponseTime(time, type);
      distribution[category]++;
    }

    // Transform to match interface naming conventions
    if (type === 'api') {
      return {
        fastRequests: distribution.fast,
        acceptableRequests: distribution.acceptable,
        slowRequests: distribution.slow,
        criticalRequests: distribution.critical,
      };
    } else if (type === 'database') {
      return {
        fastQueries: distribution.fast,
        acceptableQueries: distribution.acceptable,
        slowQueries: distribution.slow,
        criticalQueries: distribution.critical,
      };
    }

    return distribution;
  }

  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);

    // Limit alerts history
    if (this.alerts.length > 1000) {
      this.alerts.shift();
    }

    this.logger.warn(`Performance alert: ${alert.message}`, {
      type: alert.type,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      details: alert.details,
    });
  }

  private getRecentAlerts(hours: number): PerformanceAlert[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.alerts.filter((alert) => alert.timestamp > cutoff);
  }

  private generateHourlyReport(): void {
    const report = this.generatePerformanceReport(1);

    if (report.alerts.length > 0 || report.summary.slowRequestsCount > 10) {
      this.logger.warn('Hourly performance report shows issues', {
        slowRequests: report.summary.slowRequestsCount,
        alertsCount: report.alerts.length,
        avgResponseTime: report.summary.averageResponseTime,
        errorRate: report.summary.errorRate,
      });
    }
  }

  private generateRecommendations(apiDist: any, dbDist: any): string[] {
    const recommendations: string[] = [];

    if (apiDist.slow + apiDist.critical > apiDist.fast) {
      recommendations.push(
        'Consider implementing API response caching for frequently accessed endpoints',
      );
      recommendations.push(
        'Review slow API endpoints and optimize database queries',
      );
    }

    if (dbDist.slow + dbDist.critical > dbDist.fast) {
      recommendations.push('Review and optimize slow database queries');
      recommendations.push(
        'Consider adding database indexes for frequently queried fields',
      );
      recommendations.push(
        'Implement database query caching where appropriate',
      );
    }

    if (
      this.getRecentAlerts(1).some(
        (a) => a.type === 'memory' && a.severity === 'critical',
      )
    ) {
      recommendations.push(
        'Investigate memory leaks and optimize memory usage',
      );
      recommendations.push(
        'Consider increasing server memory or implementing better memory management',
      );
    }

    return recommendations;
  }

  private limitHistorySize(array: number[]): void {
    if (array.length > this.maxHistorySize) {
      array.splice(0, array.length - this.maxHistorySize);
    }
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  private percentile(numbers: number[], p: number): number {
    if (numbers.length === 0) return 0;

    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}
