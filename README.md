# PivotSense

Hackathon app for monitoring centre-pivot irrigators. Vite + React on the
front end, Supabase (Postgres + auth) on the back end, Mapbox for the
satellite map.

## Getting started

1. **Install deps**

   ```sh
   npm install
   ```

2. **Configure env vars**

   Copy the template and fill it in:

   ```sh
   cp .env.example .env
   ```

   `.env` is gitignored — your local values won't affect teammates.

   You need a Mapbox token (`VITE_MAPBOX_ACCESS_TOKEN`) and a Supabase
   URL + publishable key. Pick one of the two Supabase paths below.

3. **Run the dev server**

   ```sh
   npm run dev
   ```

## Supabase: local Docker

Best for offline hackathon work — everything runs on your machine.

```sh
npx supabase start         # boots Postgres, Auth, Storage in Docker
npx supabase status        # prints the URL + publishable key
npx supabase db reset      # applies migrations under supabase/migrations/
```

The defaults already in `.env.example` match a stock local instance:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

Run `npx supabase db reset` whenever you pull new migrations.

## Supabase: hosted project

Best for sharing data with the rest of the team.

1. Create a project at https://supabase.com.
2. From **Project Settings → API**, copy the **Project URL** and the
   **anon / publishable** key into your `.env`:

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
   ```

3. Link and push the migrations once:

   ```sh
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

## Tests

```sh
npm test               # Playwright suite
npm run screenshot     # screenshot-only tests
```
