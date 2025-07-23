import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import { AuthUser } from '../interfaces/auth.interface';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(req: any, email: string, password: string): Promise<AuthUser> {
    console.log('🚀 LocalStrategy.validate called with:', { email, password: password.substring(0, 5) + '***' });
    
    const { tenantId, deviceFingerprint } = req.body;

    try {
      const user = await this.authService.validateUser(
        email,
        password,
        tenantId,
        {
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.headers['user-agent'] || '',
          deviceFingerprint,
        },
      );

      if (!user) {
        console.log('❌ LocalStrategy: validateUser returned null');
        throw new UnauthorizedException('Invalid credentials');
      }

      console.log('✅ LocalStrategy: validateUser returned user:', user.email);
      return user;
    } catch (error) {
      // Re-throw ForbiddenException and other specific exceptions
      if (error.status === 403 || error.name === 'ForbiddenException') {
        throw error;
      }
      
      // For all other errors, throw UnauthorizedException
      console.log('❌ LocalStrategy: validateUser error:', error.message);
      throw new UnauthorizedException('Invalid credentials');
    }
  }
}
