import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SecurityContext } from '../interfaces/auth.interface';

export const CurrentUser = createParamDecorator(
  (
    data: keyof SecurityContext | undefined,
    ctx: ExecutionContext,
  ): SecurityContext | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.securityContext || request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
