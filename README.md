# 🌐 GitVisualizer AI

![GitVisualizer AI](https://img.shields.io/badge/Status-Active-brightgreen) ![License](https://img.shields.io/badge/License-MIT-blue) ![Version](https://img.shields.io/badge/Version-1.0.0-orange)

**GitVisualizer AI** is a cutting-edge, zero-database, serverless web application designed to bring GitHub repositories to life. Our vision is to provide developers, researchers, and tech enthusiasts with an intuitive platform to intuitively visualize codebase structures and perform semantic RAG (Retrieval-Augmented Generation) code searches.

Powered by modern web technologies and a multi-provider AI architecture, GitVisualizer AI bridges the gap between raw source code and deep architectural understanding.

---

## 🚀 Live Demo

Try out the live application and test your repositories right now!

**👉 [https://gitvisualizer-ai.vercel.app/](https://gitvisualizer-ai.vercel.app/)**

---

## ✨ Features

* **Multi-Provider AI Support:** Seamlessly switch between top-tier AI providers including OpenAI, OpenRouter, Together.ai, and Google Gemini for analysis, summarization, and RAG search.
* **Semantic RAG Code Search:** Ask natural language questions about the codebase and get context-aware answers grounded in the actual source code.
* **Zero-Database Architecture:** Fully serverless design using Vercel Serverless Functions and in-memory/JSON file state persistence—no complex database setup required.
* **Interactive Visualizations:** Deep dive into repository structures with visually appealing and interactive graphs.
* **Modern Tech Stack:** Built with React 18, Vite, Tailwind CSS, TypeScript, and Shadcn UI components for a robust, fast, and responsive user experience.
* **Developer Friendly:** Extensive and clear API routes built for ease of integration and future expansion.

---

## 🛠️ Tech Stack & Architecture

* **Frontend:** React, Vite, Tailwind CSS, TypeScript, Radix UI / Shadcn UI
* **Backend:** Vercel Serverless Functions (`api/` directory)
* **AI Integration:** Support for OpenAI-compatible endpoints and specific provider integrations.
* **State/Persistence:** Stateless/Serverless by default, with optional local JSON persistence for caching and state management during local development.

---

## 🏁 Getting Started (Localhost)

Follow these step-by-step instructions to get GitVisualizer AI running on your local machine.

### Prerequisites

Ensure you have the following installed and configured:
* **Node.js** (v18 or higher recommended)
* **npm** (or **bun**)
* **GitHub Personal Access Token:** To fetch private repos and avoid strict rate limits.
* **AI Provider API Key:** An API key from OpenAI, OpenRouter, Together.ai, or Gemini.

### 1. Clone the Repository

```bash
git clone https://github.com/hieuit095/gitvisualizer-ai.git
cd gitvisualizer-ai
```

### 2. Install Dependencies

Using npm:
```bash
npm install
```

### 3. Environment Configuration

Copy the provided example environment file to create your own `.env` file:

```bash
cp .env.example .env
```

Open `.env` in your preferred editor and configure the essential variables:

```ini
# Choose your AI provider (e.g., openai, openrouter, together, gemini)
AI_PROVIDER=openai

# Your AI provider API key
AI_API_KEY=sk-your-api-key-here

# (Optional) GitHub Token to increase rate limits and access private repositories
GITHUB_TOKEN=ghp_your_github_token_here

# Optional: Set a specific chat model
# AI_CHAT_MODEL=gpt-4o-mini
```

### 4. Run the Development Server

Start the Vite development server and the API endpoints:

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser to start exploring!

---

## ☁️ Deployment on Vercel

Deploying GitVisualizer AI to Vercel is straightforward thanks to its native Vercel Serverless Functions support.

### Step-by-Step Deployment

1. **Push to GitHub:** Ensure your local repository is pushed to your GitHub account.
2. **Log into Vercel:** Go to [Vercel](https://vercel.com/) and sign in.
3. **Add New Project:** Click "Add New" -> "Project" and import your `gitvisualizer-ai` repository from GitHub.
4. **Configure Environment Variables:** In the deployment configuration step, add the environment variables from your `.env` file. You **must** include:
   * `AI_PROVIDER`
   * `AI_API_KEY`
   * `GITHUB_TOKEN` (Highly recommended)
5. **Deploy:** Click the **Deploy** button. Vercel will automatically build the React frontend and deploy the serverless functions in the `api/` directory.
6. **Visit Your App:** Once the build completes, Vercel will provide you with a live URL to access your deployed application.

---

## 📜 Available Scripts

In the project directory, you can run:

* `npm run dev`: Starts the development server.
* `npm run build`: Builds the application for production.
* `npm run preview`: Previews the production build locally.
* `npm run lint`: Lints the codebase using ESLint to ensure code quality.
* `npm run test`: Runs the Vitest test suite to verify code functionality.
* `npm run test:watch`: Runs the tests in interactive watch mode.

---

## 🤝 Contributing

We welcome contributions! Please feel free to submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
