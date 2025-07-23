import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Get,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CoordinatedSecurity } from '../common/guards/coordinated-security.guard';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
} from './dto/auth.dto';
import { SecurityContext } from './interfaces/auth.interface';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: ExpressRequest & { user: any },
  ) {
    console.log('🚀🚀🚀 AuthController.login method REACHED!!! 🚀🚀🚀');
    console.log('📧 Login attempt with email:', loginDto.email);
    console.log('🔍 Request body received:', loginDto);
    console.log('🔑 req.user from LocalAuthGuard:', req.user);
    
    // The LocalAuthGuard should have set req.user if authentication succeeded
    if (!req.user) {
      console.log('❌ No user found in request after LocalAuthGuard');
      throw new UnauthorizedException('Authentication failed');
    }

    // Generate tokens for the authenticated user
    const sessionId = require('uuid').v7();
    const tokens = await this.authService.generateTokens(req.user, sessionId);

    console.log('✅ Login successful for user:', req.user.email);
    return {
      user: req.user,
      tokens,
      isFirstLogin: !req.user.lastLoginAt,
      requiresPasswordChange: false,
      mfaRequired: false,
    };
  }

  @Public()
  @CoordinatedSecurity({ enabled: true, enableMonitoring: true })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.CREATED)
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(userId, changePasswordDto);
    return { message: 'Password changed successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: SecurityContext) {
    return {
      id: user.userId,
      email: user.userId, // FIXME: Should be user.email when available in SecurityContext
      role: user.role,
      schoolId: user.schoolId,
      tenantId: user.tenantId,
      permissions: user.permissions,
      sessionId: user.sessionId,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: SecurityContext) {
    // TODO: Implement session invalidation in AUTH-005 (Session Management)
    // For now, client should discard tokens
    console.log('User logout:', {
      userId: user.userId,
      sessionId: user.sessionId,
      timestamp: new Date().toISOString(),
    });

    return { message: 'Logged out successfully' };
  }

  @Public()
  @Get('health')
  @HttpCode(HttpStatus.OK)
  healthCheck() {
    console.log('🏥 Auth health endpoint called');
    return {
      success: true,
      data: {
        status: 'ok',
        service: 'authentication',
        timestamp: new Date().toISOString(),
      }
    };
  }

  @Public()
  @Get('test')
  @HttpCode(HttpStatus.OK)
  testEndpoint() {
    console.log('🧪 Auth test endpoint called');
    return {
      message: 'Auth controller is working',
      timestamp: new Date().toISOString(),
    };
  }
}
