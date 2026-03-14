# GitVisualizer AI

GitVisualizer AI is a zero-database, serverless web application that visualizes GitHub repositories, provides RAG code search, and analyzes system architectures using AI. 

## Key Features

1. **Zero Database**: No complex database configuration (like Supabase or Postgres) is required. Data is cached in-memory and heavily relies on ephemeral Vercel Serverless Function architecture or a local `data/` directory.
2. **Flexible AI Providers**: Simply configure the environment variables to use OpenAI, OpenRouter, Together.ai, or Google Gemini.
3. **Smart Ignore Engine**: Analyzes real source code while cleverly ignoring artifacts, build outputs, and vendor folders.

## How to Run Locally

To get started on your personal machine without needing any database setup:

1. Clone the repository:
   ```bash
   git clone <YOUR_GIT_URL>
   cd gitvisualizer-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment variables:
   Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   cp .env.example .env
   ```

   **Example `.env`**:
   ```env
   # Choose from: "openai", "openrouter", "together", "gemini"
   AI_PROVIDER=openai
   AI_API_KEY=sk-your-api-key

   # Optional GitHub Token (to avoid rate limits for repo reading)
   GITHUB_TOKEN=ghp_...
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

## Deploying to Vercel

Deployment is as simple as running standard Vercel configurations. Since the app is completely stateless and serverless, no external Postgres/Supabase instance is needed.

1. Install the Vercel CLI or connect your GitHub repository to Vercel.
2. Ensure you add `AI_PROVIDER` and `AI_API_KEY` (and optionally `GITHUB_TOKEN`) to your project's Environment Variables in the Vercel dashboard.
3. Click deploy! The `/api/*` endpoints handle all necessary AI embedding and chat workflows on the fly.

## Technologies Used

- **Frontend**: Vite, React 18, TypeScript, Tailwind CSS, shadcn-ui
- **Backend / AI APIs**: Vercel Serverless Functions (`/api`), native `fetch` wrappers for streaming LLM outputs.
