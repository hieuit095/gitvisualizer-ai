<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/git-branch.svg" alt="GitVisualizer AI logo" width="100" height="100">

  # GitVisualizer AI

  Visualize GitHub repositories with AI-generated architecture diagrams, node summaries, and code-aware chat.
</div>

## Overview

GitVisualizer AI analyzes a repository tree, filters out non-source noise, extracts lightweight structure from important files, and asks an OpenAI-compatible model to generate an architecture graph. The frontend renders that graph as an interactive diagram with node drill-down, history, sharing, and repo chat.

The app is serverless and database-free by default. Analysis history and code chunks are stored in memory, with optional JSON persistence if `DATA_DIR` is configured.

## Highlights

- Interactive architecture graph built with React Flow
- File-level AI summaries and repo-wide chat with semantic search fallback
- OpenAI-compatible provider support with custom base URL and model selection
- Private repository support through a locally stored GitHub token
- Analysis history, share links, and Markdown/Mermaid export

## Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui primitives
- Vercel serverless functions in `api/`
- OpenAI-compatible chat/embedding APIs

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/hieuit095/gitvisualizer-ai/
cd gitvisualizer-ai
npm install
```

### Configure environment

Copy the example file and adjust the values:

```bash
cp .env.example .env
```

Minimal OpenAI preset:

```env
AI_PROVIDER=openai
AI_API_KEY=sk-your-api-key
AI_CHAT_MODEL=gpt-4o-mini
```

OpenRouter preset:

```env
AI_PROVIDER=openrouter
AI_API_KEY=sk-or-v1-your-openrouter-key
AI_CHAT_MODEL=openai/gpt-4o-mini
OPENROUTER_HTTP_REFERER=https://your-app.example
OPENROUTER_APP_NAME=GitVisualizer AI
```

Custom OpenAI-compatible provider:

```env
AI_PROVIDER=my-provider
AI_API_KEY=your-provider-key
AI_BASE_URL=https://api.example.com/v1
AI_CHAT_MODEL=my-chat-model
AI_EMBEDDING_MODEL=my-embedding-model
AI_ENABLE_EMBEDDINGS=true
```

Optional variables:

- `GITHUB_TOKEN`: improves rate limits and enables private repo access
- `DATA_DIR`: enables JSON persistence across local runs
- `AI_MODEL`: legacy alias for `AI_CHAT_MODEL`

## Run locally

```bash
npm run dev
```

Open the local URL printed by Vite, paste a GitHub repository URL, and start exploring.

## AI Provider Configuration

The backend now treats the built-in providers as presets, not as a hard allowlist.

- `AI_PROVIDER` can be `openai`, `openrouter`, `together`, `gemini`, or any custom label.
- If you use a custom label, set `AI_BASE_URL` to an OpenAI-compatible `/v1` base URL.
- `AI_CHAT_MODEL` controls the model used for repository analysis, node summaries, and chat.
- `AI_EMBEDDING_MODEL` controls semantic search. If it is unset, the app falls back to text search.
- `AI_ENABLE_EMBEDDINGS=false` disables semantic search even for presets that support embeddings.

## Deploying

Deploy to Vercel as a standard Vite app with serverless functions:

1. Import the repo into Vercel.
2. Add the environment variables from `.env.example`.
3. Deploy.

The `api/` directory is picked up automatically as Vercel functions.
