import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Indonesian phone number validator
@ValidatorConstraint({ name: 'isIndonesianPhoneNumber', async: false })
export class IsIndonesianPhoneNumberConstraint implements ValidatorConstraintInterface {
  validate(phoneNumber: string, args: ValidationArguments) {
    if (!phoneNumber) return false;
    
    // Remove spaces, dashes, and parentheses
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // Check Indonesian phone number patterns
    // +62 or 0 followed by operator code and number
    const patterns = [
      /^\+62[0-9]{9,12}$/, // International format
      /^0[0-9]{9,12}$/, // Local format
      /^62[0-9]{9,12}$/, // Without plus
    ];
    
    return patterns.some(pattern => pattern.test(cleaned));
  }

  defaultMessage(args: ValidationArguments) {
    return 'Phone number must be a valid Indonesian phone number';
  }
}

export function IsIndonesianPhoneNumber(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIndonesianPhoneNumberConstraint,
    });
  };
}

// Strong password validator
@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(password: string, args: ValidationArguments) {
    if (!password) return false;
    
    const minLength = args.constraints[0] || 8;
    
    // Check length
    if (password.length < minLength) return false;
    
    // Check for at least one uppercase letter
    if (!/[A-Z]/.test(password)) return false;
    
    // Check for at least one lowercase letter
    if (!/[a-z]/.test(password)) return false;
    
    // Check for at least one number
    if (!/[0-9]/.test(password)) return false;
    
    // Check for at least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;
    
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    const minLength = args.constraints[0] || 8;
    return `Password must be at least ${minLength} characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character`;
  }
}

export function IsStrongPassword(minLength?: number, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [minLength],
      validator: IsStrongPasswordConstraint,
    });
  };
}

// UUID validator
export function IsUUID(version?: '3' | '4' | '5' | 'all', validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isUUID',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value || typeof value !== 'string') return false;
          
          const patterns = {
            3: /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            5: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            all: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          };
          
          const pattern = patterns[version || 'all'];
          return pattern.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid UUID${version ? ` version ${version}` : ''}`;
        },
      },
    });
  };
}

// NISN (Indonesian student number) validator
export function IsNISN(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isNISN',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value || typeof value !== 'string') return false;
          
          // NISN is 10 digits
          return /^[0-9]{10}$/.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return 'NISN must be exactly 10 digits';
        },
      },
    });
  };
}

// Date range validator
export function IsDateInRange(minDate: Date, maxDate: Date, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isDateInRange',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [minDate, maxDate],
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value) return false;
          
          const date = new Date(value);
          if (isNaN(date.getTime())) return false;
          
          const [min, max] = args.constraints;
          return date >= min && date <= max;
        },
        defaultMessage(args: ValidationArguments) {
          const [min, max] = args.constraints;
          return `Date must be between ${min.toISOString()} and ${max.toISOString()}`;
        },
      },
    });
  };
}

// Future date validator
export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value) return false;
          
          const date = new Date(value);
          if (isNaN(date.getTime())) return false;
          
          return date > new Date();
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a future date`;
        },
      },
    });
  };
}

// Academic year validator
export function IsAcademicYear(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isAcademicYear',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (!value || typeof value !== 'string') return false;
          
          // Format: YYYY/YYYY (e.g., 2023/2024)
          return /^[0-9]{4}\/[0-9]{4}$/.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return 'Academic year must be in format YYYY/YYYY (e.g., 2023/2024)';
        },
      },
    });
  };
}
