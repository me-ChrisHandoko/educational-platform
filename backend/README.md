# Educational Platform Backend - Enterprise Edition

## Overview

This is an enterprise-grade backend for a comprehensive educational management system designed for Indonesian multi-tenant networks. Built with NestJS, TypeScript, and PostgreSQL, it provides a robust, scalable, and secure foundation for managing schools, students, teachers, and parents.

## Key Features

### 🏢 Multi-Tenant Architecture
- Schema-based tenant isolation
- Subdomain routing support
- Tenant-specific configurations
- Cross-tenant analytics

### 🔐 Enterprise Security
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC)
- Account lockout protection
- Rate limiting per user/IP
- CSRF protection
- Security headers (Helmet)
- Input validation & sanitization

### 🚀 Performance & Scalability
- Connection pooling
- Redis caching
- Query optimization
- Circuit breaker pattern
- Distributed tracing
- Metrics collection (Prometheus)
- Graceful shutdown

### 📊 Monitoring & Observability
- Structured logging (Winston)
- Distributed tracing (OpenTelemetry)
- Health checks
- Metrics endpoint
- Error tracking
- Performance monitoring

### 🛡️ Data Protection
- Argon2 password hashing
- Audit logging
- Data encryption at rest
- GDPR compliance ready
- Backup strategies

## Tech Stack

- **Runtime**: Node.js v22 LTS
- **Framework**: NestJS v11
- **Language**: TypeScript v5.6
- **Database**: PostgreSQL v17 with Prisma ORM
- **Cache**: Redis v7.4
- **API**: REST with OpenAPI/Swagger documentation
- **Authentication**: Passport.js with JWT
- **Validation**: class-validator
- **Testing**: Jest with integration tests
- **Documentation**: Swagger/OpenAPI

## Project Structure

```
backend/
├── src/
│   ├── auth/                 # Authentication module
│   ├── admin/               # Admin module
│   ├── common/              # Shared utilities
│   │   ├── decorators/      # Custom decorators
│   │   ├── exceptions/      # Custom exceptions
│   │   ├── filters/         # Exception filters
│   │   ├── guards/          # Security guards
│   │   ├── interceptors/    # Request/response interceptors
│   │   ├── middleware/      # Express middleware
│   │   ├── pipes/           # Validation pipes
│   │   └── services/        # Shared services
│   ├── config/              # Configuration
│   ├── database/            # Database utilities
│   ├── health/              # Health checks
│   ├── monitoring/          # Monitoring endpoints
│   ├── prisma/              # Prisma service
│   └── redis/               # Redis service
├── prisma/                  # Database schema
├── test/                    # Test files
│   ├── integration/         # Integration tests
│   ├── helpers/            # Test utilities
│   └── e2e/                # End-to-end tests
└── dist/                    # Compiled output
```

## Getting Started

### Prerequisites

- Node.js v22 or higher
- PostgreSQL v15 or higher
- Redis v7 or higher
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd educational-platform/backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Environment Variables

```env
# Application
NODE_ENV=development
APP_PORT=3001
APP_HOST=0.0.0.0
API_PREFIX=api/v1

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/edu_platform

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Security
BCRYPT_ROUNDS=10
CORS_ORIGINS=http://localhost:3000

# Rate Limiting
RATE_LIMIT_SHORT=20
RATE_LIMIT_MEDIUM=100
RATE_LIMIT_LONG=300
```

### Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed
```

### Running the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

## API Documentation

Once the application is running, you can access:

- Swagger UI: http://localhost:3001/api/v1/docs
- Health Check: http://localhost:3001/api/v1/health
- Metrics: http://localhost:3001/api/v1/metrics

## Testing

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov

# All tests
npm run test:all
```

## Enterprise Features

### Circuit Breaker

```typescript
@CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 3000,
  resetTimeout: 30000,
})
async callExternalService() {
  // Your code here
}
```

### Caching

```typescript
@Cacheable({
  ttl: 300,
  key: (args) => `user:${args[0]}`,
})
async getUser(id: string) {
  // Your code here
}
```

### Rate Limiting

```typescript
@AuthRateLimit() // 5 requests per 15 minutes
@Post('login')
async login(@Body() dto: LoginDto) {
  // Your code here
}
```

### Custom Exceptions

```typescript
throw new BusinessRuleViolationException(
  'INSUFFICIENT_BALANCE',
  'Insufficient balance for this operation',
  { required: 1000, available: 500 }
);
```

## Security Best Practices

1. **Input Validation**: All inputs are validated using class-validator
2. **SQL Injection Prevention**: Parameterized queries via Prisma
3. **XSS Protection**: Content Security Policy headers
4. **CSRF Protection**: CSRF tokens for state-changing operations
5. **Rate Limiting**: Prevents brute force attacks
6. **Secure Headers**: Helmet.js for security headers
7. **Authentication**: JWT with refresh token rotation
8. **Authorization**: Role-based access control
9. **Audit Logging**: All sensitive operations are logged
10. **Data Encryption**: Sensitive data encrypted at rest

## Performance Optimization

1. **Database Indexing**: Strategic indexes on frequently queried columns
2. **Query Optimization**: N+1 query prevention
3. **Connection Pooling**: Efficient database connection management
4. **Caching Strategy**: Redis for frequently accessed data
5. **Pagination**: Cursor-based pagination for large datasets
6. **Compression**: Response compression with gzip
7. **Lazy Loading**: Load data on demand
8. **Batch Operations**: Bulk inserts and updates

## Monitoring & Metrics

### Available Metrics

- HTTP request duration
- HTTP request count by status
- Database query duration
- Cache hit/miss rates
- Active user sessions
- Error rates by type
- Business metrics

### Health Checks

- Database connectivity
- Redis connectivity
- Disk space
- Memory usage
- External service availability

## Deployment

### Docker

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
EXPOSE 3001
CMD ["npm", "run", "start:prod"]
```

### Production Checklist

- [ ] Environment variables set
- [ ] Database migrations run
- [ ] SSL certificates configured
- [ ] Rate limiting configured
- [ ] Monitoring enabled
- [ ] Backup strategy implemented
- [ ] Log aggregation setup
- [ ] Error tracking configured
- [ ] Performance testing completed
- [ ] Security audit passed

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Follow ESLint rules
- Use Prettier for formatting
- Write meaningful commit messages
- Add tests for new features
- Update documentation

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check DATABASE_URL in .env
   - Ensure PostgreSQL is running
   - Verify network connectivity

2. **Redis Connection Failed**
   - Check Redis configuration
   - Ensure Redis server is running
   - Check firewall settings

3. **JWT Token Invalid**
   - Verify JWT secrets match
   - Check token expiration
   - Ensure clock synchronization

4. **Rate Limit Exceeded**
   - Check rate limit configuration
   - Clear Redis if needed
   - Adjust limits for development

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, email support@educational-platform.com or join our Slack channel.

## Acknowledgments

- NestJS team for the amazing framework
- Prisma team for the excellent ORM
- All contributors who have helped shape this project

---

Built with ❤️ for Indonesian education
