import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    console.log('🛡️ LocalAuthGuard.canActivate called');
    console.log('📩 Request body:', request.body);

    // Add client context to request
    request.clientContext = {
      ipAddress: request.ip || request.connection.remoteAddress,
      userAgent: request.headers['user-agent'] || '',
      timestamp: new Date(),
    };

    console.log('🔄 Calling super.canActivate to trigger LocalStrategy');
    
    try {
      // Call parent canActivate which triggers local strategy
      const result = (await super.canActivate(context)) as boolean;
      console.log('✅ super.canActivate result:', result);
      
      // Login success - user is now available in request.user
      if (result && request.user) {
        // Log successful authentication
        console.log('Local authentication successful:', {
          userId: request.user.id,
          email: request.user.email,
          ip: request.clientContext.ipAddress,
          timestamp: request.clientContext.timestamp,
        });
      }

      return result;
    } catch (error) {
      console.log('❌ super.canActivate failed:', error.message);
      throw error;
    }
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (err || !user) {
      // Log authentication failure
      console.log('Local authentication failed:', {
        email: request.body?.email,
        ip: request.clientContext?.ipAddress,
        userAgent: request.clientContext?.userAgent,
        error: err?.message || info?.message || 'Authentication failed',
        timestamp: new Date().toISOString(),
      });

      // Re-throw specific exceptions (like ForbiddenException) 
      if (err && (err.status === 403 || err.name === 'ForbiddenException')) {
        throw err;
      }

      throw new UnauthorizedException(
        err?.message || info?.message || 'Invalid credentials',
      );
    }

    return user;
  }
}
