import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { RequestContext } from '../middleware/request-context.middleware';

/**
 * Decorator to inject the request context into a controller method parameter
 */
export const Context = createParamDecorator(
  (
    data: keyof RequestContext | undefined,
    ctx: ExecutionContext,
  ): RequestContext | any => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const context = (request as any).context as RequestContext;

    return data ? context?.[data] : context;
  },
);

/**
 * Decorator to inject the request ID
 */
export const RequestId = () => Context('requestId');

/**
 * Decorator to inject the client IP address
 */
export const ClientIp = () => Context('ipAddress');

/**
 * Decorator to inject the user agent
 */
export const UserAgent = () => Context('userAgent');
