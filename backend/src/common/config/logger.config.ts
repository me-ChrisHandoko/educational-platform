import { LoggerService, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  trace?: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export class CustomLogger implements LoggerService {
  private configService: ConfigService<AppConfig>;

  constructor(configService: ConfigService<AppConfig>) {
    this.configService = configService;
  }

  /**
   * Write a 'log' level log.
   */
  log(message: any, context?: string): void;
  log(message: any, ...optionalParams: any[]): void;
  log(
    message: any,
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    this.writeLog('log', message, contextOrParams, optionalParams);
  }

  /**
   * Write an 'error' level log.
   */
  error(message: any, trace?: string, context?: string): void;
  error(message: any, ...optionalParams: any[]): void;
  error(
    message: any,
    traceOrParams?: string | any[],
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    this.writeLog(
      'error',
      message,
      traceOrParams,
      contextOrParams,
      optionalParams,
    );
  }

  /**
   * Write a 'warn' level log.
   */
  warn(message: any, context?: string): void;
  warn(message: any, ...optionalParams: any[]): void;
  warn(
    message: any,
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    this.writeLog('warn', message, contextOrParams, optionalParams);
  }

  /**
   * Write a 'debug' level log.
   */
  debug(message: any, context?: string): void;
  debug(message: any, ...optionalParams: any[]): void;
  debug(
    message: any,
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    this.writeLog('debug', message, contextOrParams, optionalParams);
  }

  /**
   * Write a 'verbose' level log.
   */
  verbose(message: any, context?: string): void;
  verbose(message: any, ...optionalParams: any[]): void;
  verbose(
    message: any,
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    this.writeLog('verbose', message, contextOrParams, optionalParams);
  }

  private writeLog(
    level: LogLevel,
    message: any,
    contextOrParams?: string | any[],
    ...optionalParams: any[]
  ): void {
    const logLevel =
      this.configService.get('monitoring.logLevel', { infer: true }) || 'info';

    if (!this.shouldLog(level, logLevel)) {
      return;
    }

    const logEntry: LogEntry = {
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
    };

    // Extract context and metadata
    if (typeof contextOrParams === 'string') {
      logEntry.context = contextOrParams;
      if (optionalParams.length > 0 && typeof optionalParams[0] === 'object') {
        logEntry.metadata = optionalParams[0];
      }
    } else if (Array.isArray(contextOrParams)) {
      if (
        contextOrParams.length > 0 &&
        typeof contextOrParams[0] === 'object'
      ) {
        logEntry.metadata = contextOrParams[0];
      }
    }

    // For error logs, handle trace
    if (
      level === 'error' &&
      typeof contextOrParams === 'string' &&
      optionalParams.length > 0
    ) {
      logEntry.trace = contextOrParams;
      if (typeof optionalParams[0] === 'string') {
        logEntry.context = optionalParams[0];
      }
      if (optionalParams.length > 1 && typeof optionalParams[1] === 'object') {
        logEntry.metadata = optionalParams[1];
      }
    }

    this.formatAndOutput(logEntry);
  }

  private shouldLog(messageLevel: LogLevel, configuredLevel: string): boolean {
    const levels: Record<string, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      verbose: 4,
    };

    const messageLevelNum = levels[messageLevel] ?? 2;
    const configuredLevelNum = levels[configuredLevel] ?? 2;

    return messageLevelNum <= configuredLevelNum;
  }

  private formatAndOutput(logEntry: LogEntry): void {
    const environment = this.configService.get('app.environment', {
      infer: true,
    });

    if (environment === 'production') {
      // Structured JSON logging for production
      console.log(JSON.stringify(logEntry));
    } else {
      // Human-readable logging for development
      this.formatDevelopmentLog(logEntry);
    }
  }

  private formatDevelopmentLog(logEntry: LogEntry): void {
    const { level, message, context, trace, timestamp, metadata } = logEntry;

    // Color coding for different log levels
    const colors = {
      error: '\x1b[31m', // Red
      warn: '\x1b[33m', // Yellow
      log: '\x1b[32m', // Green
      debug: '\x1b[36m', // Cyan
      verbose: '\x1b[35m', // Magenta
    };

    const reset = '\x1b[0m';
    const levelColor = colors[level] || colors.log;

    const timeString = new Date(timestamp).toLocaleTimeString();
    const contextString = context ? ` [${context}]` : '';
    const metadataString = metadata
      ? ` ${JSON.stringify(metadata, null, 2)}`
      : '';

    const logMessage = `${levelColor}[${level.toUpperCase()}]${reset} ${timeString}${contextString} ${message}${metadataString}`;

    console.log(logMessage);

    if (trace) {
      console.log(`${levelColor}Stack trace:${reset}`);
      console.log(trace);
    }
  }
}

/**
 * Logger factory function
 */
export function createLogger(
  configService: ConfigService<AppConfig>,
): LoggerService {
  return new CustomLogger(configService);
}

/**
 * Logger configuration for different environments
 */
export const loggerConfig = {
  development: {
    level: 'debug',
    format: 'human-readable',
    enableColors: true,
    enableTimestamp: true,
  },
  production: {
    level: 'info',
    format: 'json',
    enableColors: false,
    enableTimestamp: true,
  },
  test: {
    level: 'error',
    format: 'minimal',
    enableColors: false,
    enableTimestamp: false,
  },
};
