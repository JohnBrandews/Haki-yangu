# HakiYangu Frontend

This is the Next.js app for HakiYangu. The API routes under `src/app/api` now handle chat, letter generation, and scenario data, so this folder is the only part you need to deploy to Vercel.

## Getting Started

1. `npm install`
2. Set `ANTHROPIC_API_KEY` in `.env`
3. Make sure `NEXT_PUBLIC_API_URL` is unset or empty so requests stay on the Next.js `/api` routes
4. `npm run dev`

Open `http://localhost:3000` to use the app locally.

## Deployment

Deploy this folder to Vercel as a single Next.js app. No separate NestJS backend is required.
