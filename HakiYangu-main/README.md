# HakiYangu

HakiYangu is an AI-powered legal rights assistant for Kenya. The whole app now runs inside the Next.js frontend, including the API routes that handle Claude requests, scenario data, and demand-letter generation.

## What It Does

- Bilingual legal guidance in English and Swahili
- Scenario-based shortcuts for common disputes
- Demand and complaint letter generation
- Lightweight rate limiting without a database

## Project Layout

- `frontend/` contains the Next.js app and all route handlers
- `backend/` is legacy NestJS code kept only for reference

## Local Development

1. `cd frontend`
2. `npm install`
3. Set `ANTHROPIC_API_KEY` in `frontend/.env`
4. `npm run dev`

## Deployment

Deploy the `frontend` app to Vercel. No separate backend service is required.

## Disclaimer

HakiYangu is an informational tool and does not provide legal advice. For complex matters, consult a registered advocate.
