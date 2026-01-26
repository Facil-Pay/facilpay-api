# facilpay-api
Backend API service for FacilPay - Stellar-based multi-chain payment gateway. Handles payment processing, webhook management, settlement operations, and merchant integrations.


# FacilPay API

Backend API built with **NestJS**.

---

## 🚀 Requirements

- Node.js 18+ 
- npm

---

## ⚙️ Setup Instructions

1. Install dependencies
```bash
npm install
```

## Create environment file
```bash
cp .env.example .env
```

## Run the application
```bash
npm run start:dev
```
 ## The application will be available at:
http://localhost:3000   


```md
## 🩺 Health Check

To verify the API is running correctly, use the health check endpoint:

```bash
curl -i http://localhost:3000/health 
```

Expected Response

Status: 200 OK

Body:
```json
{
  "status": "ok"
}
```

## 🔐 Authentication

The API includes a JWT-based authentication system with the following endpoints:

### Register a new user
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Login user
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Access protected route
```bash
curl -X GET http://localhost:3000/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📁 Project Structure

src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── jwt.strategy.ts
│   │   ├── guards/
│   │   └── decorators/
│   ├── users/
│   │   ├── user.entity.ts
│   │   ├── dto/
│   │   └── users.module.ts
│   └── health/
│       ├── health.controller.ts
│       ├── health.service.ts
│       └── health.module.ts
├── app.controller.ts
├── app.service.ts
├── app.module.ts
└── main.ts


## 🧪 Development

The server runs on port 3000 by default.

The port can be configured using the PORT variable in the .env file

## 📊 Logging

Logging is structured with Pino and writes rotating files under the log directory.

Environment variables:

- LOG_LEVEL (default: info in production, debug in development)
- LOG_DIR (default: logs)
- LOG_PRETTY (default: true in development, false in production)
- LOG_MAX_SIZE (default: 10m)
- LOG_RETENTION_DAYS (default: 14)
- LOG_BODY (default: false)
- LOG_BODY_MAX_LENGTH (default: 2048)
- LOG_RESPONSE_BODY (default: false)

## 🔒 Security Features

- JWT token-based authentication
- Password hashing with bcrypt
- Protected routes with guards
- Public route decorator
- Current user decorator
- Role-based access control (ready for implementation)
