import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

// Strong password validator
@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint
  implements ValidatorConstraintInterface
{
  validate(password: string, args: ValidationArguments) {
    if (!password) return false;

    // At least 8 characters
    if (password.length < 8) return false;

    // At least one uppercase letter
    if (!/[A-Z]/.test(password)) return false;

    // At least one lowercase letter
    if (!/[a-z]/.test(password)) return false;

    // At least one number
    if (!/\d/.test(password)) return false;

    // At least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;

    // No common patterns
    const commonPatterns = [
      /123456/,
      /password/i,
      /qwerty/i,
      /admin/i,
      /letmein/i,
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) return false;
    }

    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character. Avoid common patterns.';
  }
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStrongPasswordConstraint,
    });
  };
}

// Indonesian phone number validator
@ValidatorConstraint({ name: 'isIndonesianPhone', async: false })
export class IsIndonesianPhoneConstraint
  implements ValidatorConstraintInterface
{
  validate(phone: string, args: ValidationArguments) {
    if (!phone) return true; // Optional field

    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Indonesian phone number patterns
    // Mobile: 08xxxxxxxxx (10-13 digits) or +628xxxxxxxxx
    // Landline: 021xxxxxxx, 022xxxxxxx, etc.

    if (digits.startsWith('628')) {
      // International format +62
      return digits.length >= 12 && digits.length <= 15;
    } else if (digits.startsWith('08')) {
      // Local mobile format
      return digits.length >= 10 && digits.length <= 13;
    } else if (digits.startsWith('0')) {
      // Local landline format
      return digits.length >= 9 && digits.length <= 12;
    }

    return false;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Phone number must be a valid Indonesian phone number (e.g., 08123456789, +628123456789, or 0211234567)';
  }
}

export function IsIndonesianPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIndonesianPhoneConstraint,
    });
  };
}

// Safe string validator (no HTML/script injection)
@ValidatorConstraint({ name: 'isSafeString', async: false })
export class IsSafeStringConstraint implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    if (!text) return true; // Allow empty strings

    // Disallow HTML tags
    if (/<[^>]*>/.test(text)) return false;

    // Disallow script-like content
    if (/javascript:/gi.test(text)) return false;
    if (/on\w+\s*=/gi.test(text)) return false;

    // Disallow SQL injection patterns
    if (
      /(union|select|insert|update|delete|drop|create|alter|exec|execute)\s+/gi.test(
        text,
      )
    )
      return false;

    // Disallow path traversal
    if (/\.\.\/|\.\.\\/.test(text)) return false;

    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Text contains potentially unsafe content (HTML tags, scripts, or SQL patterns)';
  }
}

export function IsSafeString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsSafeStringConstraint,
    });
  };
}

// UUID validator with version check
@ValidatorConstraint({ name: 'isUUIDv4', async: false })
export class IsUUIDv4Constraint implements ValidatorConstraintInterface {
  validate(uuid: string, args: ValidationArguments) {
    if (!uuid) return false;

    const uuidv4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidv4Regex.test(uuid);
  }

  defaultMessage(args: ValidationArguments) {
    return 'Must be a valid UUID v4';
  }
}

export function IsUUIDv4(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsUUIDv4Constraint,
    });
  };
}

// Email domain whitelist validator
@ValidatorConstraint({ name: 'isAllowedEmailDomain', async: false })
export class IsAllowedEmailDomainConstraint
  implements ValidatorConstraintInterface
{
  private allowedDomains = [
    // Educational domains
    'edu',
    'ac.id',
    'sch.id',
    // Common email providers
    'gmail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    // Indonesian providers
    'yahoo.co.id',
    'gmail.co.id',
  ];

  validate(email: string, args: ValidationArguments) {
    if (!email) return false;

    const domain = email.split('@')[1];
    if (!domain) return false;

    // Check if domain is in whitelist or ends with allowed educational domains
    return this.allowedDomains.some(
      (allowedDomain) =>
        domain === allowedDomain || domain.endsWith('.' + allowedDomain),
    );
  }

  defaultMessage(args: ValidationArguments) {
    return 'Email domain not allowed. Please use an educational or recognized email provider.';
  }
}

export function IsAllowedEmailDomain(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsAllowedEmailDomainConstraint,
    });
  };
}
