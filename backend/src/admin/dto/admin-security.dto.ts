import {
  IsEmail,
  IsIP,
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UnlockUserDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address of the user to unlock',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'Customer support request #12345',
    description: 'Reason for unlocking the user',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UnlockIpDto {
  @ApiProperty({
    example: '192.168.1.100',
    description: 'IP address to unlock',
  })
  @IsIP()
  ip: string;

  @ApiPropertyOptional({
    example: 'Network maintenance completed',
    description: 'Reason for unlocking the IP',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BulkUnlockDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['user1@example.com', 'user2@example.com'],
    description: 'Array of email addresses to unlock',
  })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emails?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['192.168.1.100', '10.0.0.50'],
    description: 'Array of IP addresses to unlock',
  })
  @IsOptional()
  @IsArray()
  @IsIP(undefined, { each: true })
  ips?: string[];

  @ApiProperty({
    example: 'Emergency maintenance unlock',
    description: 'Reason for bulk unlock operation',
  })
  @IsString()
  reason: string;
}

export class SecurityEventQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number for pagination',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Number of items per page' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'failed_attempt',
    description: 'Type of security event to filter by',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Filter by user email',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: '192.168.1.100',
    description: 'Filter by IP address',
  })
  @IsOptional()
  @IsIP()
  ip?: string;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00Z',
    description: 'Start date for event filtering',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    example: '2024-01-31T23:59:59Z',
    description: 'End date for event filtering',
  })
  @IsOptional()
  @IsString()
  to?: string;
}

export class EmergencyActionDto {
  @ApiProperty({
    example: 'EMERGENCY_2024',
    description: 'Emergency confirmation code',
  })
  @IsString()
  confirmationCode: string;

  @ApiProperty({
    example: 'Critical system issue requiring immediate unlock',
    description: 'Detailed reason for emergency action',
  })
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this action requires security review',
  })
  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean = true;
}

export class MaintenanceModeDto {
  @ApiProperty({
    example: 'Scheduled security updates',
    description: 'Reason for enabling maintenance mode',
  })
  @IsString()
  reason: string;

  @ApiProperty({
    example: 60,
    description: 'Duration of maintenance mode in minutes',
  })
  @IsNumber()
  @Min(1)
  @Max(1440) // Max 24 hours
  durationMinutes: number;

  @ApiPropertyOptional({
    example: '2024-01-01T12:00:00Z',
    description: 'Estimated end time for maintenance',
  })
  @IsOptional()
  @IsString()
  estimatedEnd?: string;
}

export class SecurityThresholdUpdateDto {
  @ApiPropertyOptional({
    example: 5,
    description: 'Maximum failed login attempts before lockout',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  maxFailedAttempts?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Account lockout duration in minutes',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  lockoutDurationMinutes?: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Rate limit threshold per minute',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  rateLimitPerMinute?: number;

  @ApiProperty({
    example: 'Security policy update due to increased threats',
    description: 'Reason for threshold changes',
  })
  @IsString()
  reason: string;
}

export class WhitelistIpDto {
  @ApiProperty({
    example: '192.168.1.0/24',
    description: 'IP address or CIDR range to whitelist',
  })
  @IsString()
  ipRange: string;

  @ApiProperty({
    example: 'Admin office network',
    description: 'Description for the whitelist entry',
  })
  @IsString()
  description: string;

  @ApiPropertyOptional({
    example: '2024-12-31T23:59:59Z',
    description: 'Expiration date for whitelist entry',
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

// Response DTOs
export class SecurityStatusResponseDto {
  @ApiProperty()
  activeLockouts: number;

  @ApiProperty()
  rateLimitViolations: number;

  @ApiProperty()
  securityEvents: number;

  @ApiProperty()
  suspiciousIps: string[];

  @ApiProperty()
  systemHealth: {
    redis: { status: string; latency?: number };
    database: { status: string; latency?: number };
  };

  @ApiProperty()
  timestamp: string;
}

export class UnlockResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty()
  unlockedBy: string;

  @ApiProperty()
  timestamp: string;

  @ApiPropertyOptional()
  metadata?: Record<string, any>;
}

export class BulkUnlockResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty()
  results: {
    users: {
      successful: string[];
      failed: Array<{ email: string; error: string }>;
      skipped: string[]; // Already unlocked
    };
    ips: {
      successful: string[];
      failed: Array<{ ip: string; error: string }>;
      skipped: string[];
    };
  };

  @ApiProperty()
  processedBy: string;

  @ApiProperty()
  timestamp: string;
}
