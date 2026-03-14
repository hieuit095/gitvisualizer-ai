<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/git-branch.svg" alt="GitVisualizer AI Logo" width="100" height="100">

  # GitVisualizer AI

  **Visualize any GitHub repository in seconds with AI-powered architecture diagrams.**

  **🚀 Try it live: [https://gitvisualizer-ai.vercel.app/](https://gitvisualizer-ai.vercel.app/)**

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=flat&logo=vite&logoColor=white)](https://vitejs.dev/)
  [![React](https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
  [![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  [![Vercel](https://img.shields.io/badge/vercel-%23000000.svg?style=flat&logo=vercel&logoColor=white)](https://vercel.com/)
</div>

<br />

## 📖 Table of Contents

- [Vision & Project Overview](#-vision--project-overview)
- [Key Features](#-key-features)
- [How It Works](#-how-it-works)
- [Technologies Used](#-technologies-used)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
- [Usage](#-usage)
- [Deploying to Vercel](#-deploying-to-vercel)

---

## 🚀 Vision & Project Overview

**GitVisualizer AI** was built to solve a common developer problem: inheriting or exploring a new, large, and undocumented repository and struggling to understand its architecture. Instead of reading hundreds of files to figure out data flows and dependencies, GitVisualizer AI automatically maps it out for you.

This project is a **zero-database, serverless web application**. It analyzes GitHub repositories, provides RAG (Retrieval-Augmented Generation) code search, and generates system architecture diagrams using Large Language Models (LLMs). It uses ephemeral memory and relies heavily on Vercel's Serverless Function architecture or a local cache, eliminating the need for complex database setups (like Postgres or Supabase).

---

## ✨ Key Features

- **Zero Database Architecture**: No complex database configuration required. Data is cached in-memory locally or ephemerally in Vercel.
- **AI-Powered Architecture Diagrams**: Automatically generates interactive diagrams showing data flows, component relationships, and dependencies.
- **Multi-Provider AI Support**: Bring your own keys! Supports multiple AI providers:
  - `openai` (GPT-4o, etc.)
  - `openrouter` (Gemini, Claude, Llama, etc.)
  - `together` (Llama 3, etc.)
  - `gemini` (Google Gemini 1.5/2.0)
- **Smart Ignore Engine**: Intelligently analyzes only real source code while skipping build artifacts, `node_modules`, lock files, and vendor folders to save context window tokens and prevent API rate limiting.
- **RAG Code Search**: Ask questions about the codebase and get context-aware answers.
- **Private Repository Support**: Configure a GitHub token to analyze your private repositories securely.

---

## 🛠️ How It Works

1. **Input URL**: You paste a GitHub repository URL.
2. **Fetch & Filter**: The backend fetches the repository tree using the GitHub API and applies a "Smart Ignore" filter to drop binaries, assets, and dependencies.
3. **Extract Skeleton**: It downloads the source files and extracts "code skeletons" (function signatures, class definitions, exports/imports) to minimize payload size.
4. **AI Analysis**: The extracted structure is sent to your configured AI provider (OpenAI, Gemini, etc.) with a strict prompt to generate a structured JSON graph.
5. **Visualization**: The frontend renders the generated JSON as an interactive, draggable node-based architecture diagram.

---

## 💻 Technologies Used

- **Frontend**:
  - [Vite](https://vitejs.dev/) - Blazing fast build tool.
  - [React 18](https://react.dev/) - UI Library.
  - [TypeScript](https://www.typescriptlang.org/) - Type safety.
  - [Tailwind CSS](https://tailwindcss.com/) - Utility-first styling.
  - [shadcn/ui](https://ui.shadcn.com/) - Accessible UI components.
  - [React Flow / @xyflow/react](https://reactflow.dev/) - Interactive diagram rendering.
- **Backend**:
  - [Vercel Serverless Functions](https://vercel.com/docs/functions/serverless-functions) (`/api/*`) for stateless compute.
  - Native `fetch` wrappers for AI integrations and streaming LLM outputs.

---

## 🏁 Getting Started

To run the project locally on your machine:

### Prerequisites
- Node.js (v18 or higher recommended)
- npm, yarn, pnpm, or bun

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/hieuit095/gitvisualizer-ai/
   cd gitvisualizer-ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

### Environment Variables

You need to configure your environment variables to use the AI capabilities.

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your `.env` file:**
   Open the `.env` file and configure the available variables:

   ```env
   # ─── Required ───────────────────────────────────────────────────────────
   # AI Provider: "openai" | "openrouter" | "together" | "gemini"
   AI_PROVIDER=openai

   # Your API key for the chosen provider
   AI_API_KEY=sk-your-api-key-here

   # ─── Optional ───────────────────────────────────────────────────────────
   # Override the default model for your provider (e.g., gpt-4o-mini)
   # AI_MODEL=gpt-4o-mini

   # Override the API base URL (for custom/self-hosted endpoints)
   # AI_BASE_URL=https://api.openai.com/v1

   # GitHub token for higher rate limits / private repos
   # GITHUB_TOKEN=ghp_your_token_here

   # Application URL (used as HTTP Referer for some AI providers like OpenRouter)
   # APP_URL=http://localhost:5173

   # Directory for persistent JSON storage (defaults to in-memory only if not set)
   # DATA_DIR=./data
   ```

---

## 🕹️ Usage

Once your environment variables are configured, start the development server:

```bash
npm run dev
```

Open your browser and navigate to the local URL (usually `http://localhost:5173`).
1. Paste a public (or private, if `GITHUB_TOKEN` is set) GitHub repository URL into the input field.
2. Click **Analyze**.
3. Wait for the AI to process the code skeletons and generate the diagram.
4. Explore the interactive architecture map!

---

## ☁️ Deploying to Vercel

Deployment is extremely straightforward because the app is completely stateless and serverless. No external database instance is needed.

1. Install the [Vercel CLI](https://vercel.com/cli) or connect your GitHub repository directly to Vercel via the web dashboard.
2. In the Vercel project settings, go to **Environment Variables** and add:
   - `AI_PROVIDER` - The AI provider to use (e.g. `openai`, `openrouter`).
   - `AI_API_KEY` - The API key for your selected provider.
   - `AI_MODEL` - (Optional) Override the default model.
   - `AI_BASE_URL` - (Optional) Override the base URL for the AI API.
   - `APP_URL` - (Optional) The production URL of your deployment (used as HTTP referer).
   - `GITHUB_TOKEN` - (Optional, but highly recommended) Token to increase API limits and access private repositories.
3. Deploy! The `/api/*` directory automatically sets up Vercel Serverless Functions to handle AI analysis on the fly.
