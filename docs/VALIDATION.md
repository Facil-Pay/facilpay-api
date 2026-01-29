# Global Input Validation

## Overview

This project implements comprehensive global input validation using NestJS's `ValidationPipe` along with `class-validator` and `class-transformer` packages. All incoming requests are validated against defined DTOs, ensuring data integrity and security.

## Features

### ✅ Automatic Validation
- All endpoints automatically validate input data
- Invalid inputs return standardized error messages
- No need to manually check validation in controllers

### ✅ Type Transformation
- Request payloads are automatically transformed to DTO instances
- Enables implicit type conversion for common types

### ✅ Whitelist & Security
- Unknown properties are automatically stripped (whitelist: true)
- Non-whitelisted properties throw errors (forbidNonWhitelisted: true)
- Prevents mass assignment vulnerabilities

### ✅ Consistent Error Format
- All validation errors follow a standardized response format
- Detailed field-level error information
- Easy to parse and display in frontend applications

## Configuration

### Global Validation Pipe

Located in `src/main.ts`:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }),
);
```

### Exception Filters

Two exception filters work together to provide comprehensive error handling:

1. **ValidationExceptionFilter** (`src/common/filters/validation-exception.filter.ts`)
   - Catches `BadRequestException` (validation errors)
   - Formats validation errors into a consistent structure
   - Provides field-level error details

2. **LoggingExceptionFilter** (`src/modules/logger/logging-exception.filter.ts`)
   - Catches all other exceptions
   - Logs errors with request context
   - Extends NestJS BaseExceptionFilter

Both filters are registered globally in `src/modules/logger/logger.module.ts`.

## Error Response Format

All validation errors return the following standardized format:

```json
{
  "statusCode": 400,
  "timestamp": "2024-01-29T12:34:56.789Z",
  "path": "/api/users/register",
  "message": [
    "email must be a valid email address",
    "password must be at least 6 characters long"
  ],
  "error": "Bad Request",
  "validationErrors": [
    {
      "field": "email",
      "errors": ["email must be a valid email address"]
    },
    {
      "field": "password",
      "errors": ["password must be at least 6 characters long"]
    }
  ]
}
```

## Available Validation Decorators

### Common Validators

| Decorator | Description | Example |
|-----------|-------------|---------|
| `@IsString()` | Validates that value is a string | `@IsString()` |
| `@IsNumber()` | Validates that value is a number | `@IsNumber()` |
| `@IsEmail()` | Validates email format | `@IsEmail()` |
| `@IsEnum(enum)` | Validates against enum values | `@IsEnum(PaymentStatus)` |
| `@IsUUID()` | Validates UUID format | `@IsUUID('4')` |
| `@IsNotEmpty()` | Ensures value is not empty | `@IsNotEmpty()` |
| `@IsOptional()` | Makes field optional | `@IsOptional()` |

### String Validators

| Decorator | Description | Example |
|-----------|-------------|---------|
| `@MinLength(n)` | Minimum string length | `@MinLength(6)` |
| `@MaxLength(n)` | Maximum string length | `@MaxLength(255)` |
| `@Matches(pattern)` | Validates against regex | `@Matches(/^[A-Z]/)` |

### Number Validators

| Decorator | Description | Example |
|-----------|-------------|---------|
| `@Min(n)` | Minimum numeric value | `@Min(0.01)` |
| `@Max(n)` | Maximum numeric value | `@Max(1000)` |
| `@IsPositive()` | Must be positive number | `@IsPositive()` |
| `@IsNegative()` | Must be negative number | `@IsNegative()` |

## Creating DTOs with Validation

### Example: Basic DTO

```typescript
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  @ApiProperty({
    description: 'Item name',
    example: 'My Item',
    maxLength: 100,
  })
  name: string;
}
```

### Example: DTO with Optional Fields

```typescript
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateItemDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Optional item description',
    example: 'A detailed description',
    maxLength: 500,
  })
  description?: string;
}
```

### Example: Update DTO using PartialType

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateItemDto } from './create-item.dto';

// Automatically makes all fields from CreateItemDto optional
// while maintaining validation rules
export class UpdateItemDto extends PartialType(CreateItemDto) {}
```

## Custom Error Messages

All validation decorators support custom error messages:

```typescript
@IsEmail({}, { message: 'Please provide a valid email address' })
@MinLength(6, { message: 'Password must be at least 6 characters long' })
@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
  message: 'Password must contain uppercase, lowercase, and number',
})
```

## Best Practices

### 1. Always Use DTOs
- Create DTOs for all request bodies
- Never accept raw objects in controllers

### 2. Combine with Swagger
- Use `@ApiProperty()` alongside validation decorators
- Provides automatic API documentation
- Keeps validation and docs in sync

### 3. Use Custom Messages
- Provide clear, user-friendly error messages
- Help developers understand validation requirements
- Improve API usability

### 4. Leverage PartialType
- Use `PartialType` from `@nestjs/swagger` for update DTOs
- Maintains consistent validation rules
- Reduces code duplication

### 5. Validate at Boundaries
- Validation occurs at the API boundary
- Trust data within the application
- Don't re-validate in services

### 6. Use Strong Password Validation
```typescript
@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
  message: 'Password must contain uppercase, lowercase, number, and special character',
})
```

### 7. Validate Business Rules
```typescript
@Min(0.01, { message: 'Amount must be at least 0.01' })
@Max(1000000, { message: 'Amount cannot exceed 1,000,000' })
```

## Testing Validation

### Using cURL

```bash
# Test missing required field
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Test invalid email
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email": "invalid-email", "password": "Test123"}'

# Test weak password
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "weak"}'
```

### Expected Response (Invalid)

```json
{
  "statusCode": 400,
  "timestamp": "2024-01-29T12:34:56.789Z",
  "path": "/api/users/register",
  "message": [
    "password must be at least 6 characters long",
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  ],
  "error": "Bad Request",
  "validationErrors": [
    {
      "field": "password",
      "errors": [
        "password must be at least 6 characters long",
        "Password must contain at least one uppercase letter, one lowercase letter, and one number"
      ]
    }
  ]
}
```

## Troubleshooting

### Validation Not Working

1. Ensure `class-validator` and `class-transformer` are installed
2. Check that `ValidationPipe` is configured in `main.ts`
3. Verify DTOs have validation decorators
4. Ensure decorators are imported from `class-validator`

### Custom Error Messages Not Showing

1. Check decorator syntax: `@Decorator({ message: 'Custom message' })`
2. For some decorators, use object options: `@IsEmail({}, { message: 'Custom' })`

### Type Transformation Issues

1. Ensure `transform: true` is set in ValidationPipe
2. Add `@Type(() => Number)` for nested objects
3. Use `transformOptions.enableImplicitConversion` for basic types

## Resources

- [class-validator Documentation](https://github.com/typestack/class-validator)
- [class-transformer Documentation](https://github.com/typestack/class-transformer)
- [NestJS Validation Documentation](https://docs.nestjs.com/techniques/validation)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
