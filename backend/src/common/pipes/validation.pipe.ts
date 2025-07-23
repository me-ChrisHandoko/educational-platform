import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class GlobalValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata): Promise<any> {
    console.log('🔍 ValidationPipe transform called:', { metatype: metatype?.name, value });
    
    if (!metatype || !this.toValidate(metatype)) {
      console.log('⏭️ ValidationPipe: skipping validation');
      return value;
    }

    const object = plainToInstance(metatype, value);
    console.log('📦 ValidationPipe: transformed object:', object);
    
    const errors = await validate(object, {
      whitelist: true, // Strip non-whitelisted properties
      forbidNonWhitelisted: true, // Throw error for non-whitelisted properties
      transform: true, // Transform to target type
      validateCustomDecorators: true,
    });

    console.log('🔎 ValidationPipe: validation errors count:', errors.length);
    
    if (errors.length > 0) {
      console.log('❌ ValidationPipe: validation errors:', errors);
      const errorMessages = this.formatErrors(errors);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: errorMessages,
      });
    }

    console.log('✅ ValidationPipe: validation successful');
    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }

  private formatErrors(errors: any[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    errors.forEach((error) => {
      const field = error.property;
      const constraints = error.constraints;

      if (constraints) {
        result[field] = Object.values(constraints);
      }

      // Handle nested validation errors
      if (error.children && error.children.length > 0) {
        const nestedErrors = this.formatNestedErrors(error.children, field);
        Object.assign(result, nestedErrors);
      }
    });

    return result;
  }

  private formatNestedErrors(
    children: any[],
    parentPath: string,
  ): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    children.forEach((child) => {
      const fieldPath = `${parentPath}.${child.property}`;

      if (child.constraints) {
        result[fieldPath] = Object.values(child.constraints);
      }

      if (child.children && child.children.length > 0) {
        const nestedErrors = this.formatNestedErrors(child.children, fieldPath);
        Object.assign(result, nestedErrors);
      }
    });

    return result;
  }
}
