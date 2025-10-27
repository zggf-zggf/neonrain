# Chrome Extension Backend

Backend service for the Chrome extension built with Express.js and TypeScript.

## Development

Install dependencies:
```bash
npm install
```

Run in development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
npm start
```

## Docker

Build and run with Docker Compose:
```bash
docker-compose up --build
```

Stop the service:
```bash
docker-compose down
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/status` - Backend status
- `GET /api/test` - Test endpoint with random data

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
