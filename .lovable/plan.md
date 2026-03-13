
# GitVisualizer AI — Implementation Plan

## Overview
A web app where users paste a GitHub repo URL, the app fetches the repo structure via GitHub's API, sends it to an AI (Lovable AI / Gemini) for analysis, and renders an interactive architecture diagram using React Flow.

## Pages & Layout

### 1. Landing Page (Hero)
- Dark theme with deep charcoal background, neon cyan/violet accents
- Centered futuristic search bar for GitHub repo URLs
- URL validation with visual feedback
- Animated background elements for visual appeal
- "Analyze" button triggers the flow

### 2. Visualization Page
- **Full-screen React Flow canvas** with custom dark-themed nodes
- **Two custom node types**: FolderNode (directory) and FileNode (with type badges: Component, Utility, Hook, etc.)
- **Minimap** in bottom-right corner
- **Controls**: Zoom in/out, fit-to-view buttons
- **Auto-layout** using dagre for hierarchical arrangement
- Neon-colored edges showing dependency relationships (imports, calls)
- Loading state with progress stepper during analysis

### 3. Info Panel (Right Drawer)
- Opens on node click
- Shows AI-generated file summary, key functions, and how the file connects to others
- Small syntax-highlighted code preview section

## Backend (Edge Functions)

### `analyze-repo` Edge Function
1. Receives GitHub repo URL
2. Fetches repo file tree via GitHub REST API (public repos, no auth needed)
3. Fetches content of key files (entry points, config files, core modules)
4. Sends file structure + contents to Lovable AI (Gemini) with a prompt to extract:
   - Nodes: file name, type, purpose summary
   - Edges: dependency relationships between files
5. Returns structured JSON for React Flow rendering

## Data Flow
1. User enters GitHub URL → validate
2. Call `analyze-repo` edge function
3. Edge function fetches repo tree → identifies key files → sends to AI
4. AI returns nodes/edges JSON
5. Frontend renders React Flow diagram with dagre auto-layout
6. User clicks nodes → drawer shows AI insights

## Design System
- Background: deep charcoal (`#0f0f14`) / midnight navy
- Accent colors: Cyan (`#06b6d4`) for data flow, Violet (`#8b5cf6`) for highlights
- Node cards: dark glass-morphism style with subtle borders
- Typography: clean mono/sans-serif mix
- All interactions feel snappy with smooth animations

## Dependencies to Add
- `reactflow` — diagram engine
- `dagre` — auto-layout algorithm
- `react-syntax-highlighter` — code preview in info panel
