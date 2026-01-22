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


## 📁 Project Structure

src/
├── modules/
│   └── health/
│       ├── health.controller.ts
│       ├── health.service.ts
│       └── health.module.ts
├── app.module.ts
└── main.ts


## 🧪 Development

The server runs on port 3000 by default.

The port can be configured using the PORT variable in the .env file