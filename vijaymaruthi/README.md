# VijayMaruthi Wealth Management Platform

A unified platform combining stock analysis and personal financial ledger management.

## Documentation

| Doc | Contents |
|---|---|
| [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) | Full folder/route/endpoint/module/data-layer map |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Feature encyclopedia (what each area does + what powers it) |
| [`docs/LEDGER.md`](docs/LEDGER.md) | Ledger system deep-dive (parsing, dedup, categorization, API, tests) |
| [`../AGENTS.md`](../AGENTS.md) | Workspace knowledge base (auto-loaded by opencode) |

## Features

- **Stock Analysis**: NSE/BSE stock scanning, technical & fundamental analysis
- **Financial Ledger**: Excel import, expense tracking, budgeting, tax calculations

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+

### Installation

```bash
# Install frontend dependencies
cd frontend && npm install

# Return to root
cd ..
```

### Run the App

```bash
npm run dev
```

This single command starts both services:

- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:8765

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and backend |
| `npm run dev:frontend` | Start only the frontend |
| `npm run dev:backend` | Start only the backend |
| `npm run lint` | Run TypeScript checks |

## Project Structure

```
vijaymaruthi-platform/
├── frontend/          # Next.js frontend
│   ├── app/           # Pages and routes
│   │   ├── page.tsx   # Main dashboard
│   │   └── ledger/    # Financial ledger page
│   ├── components/    # React components
│   └── lib/           # Utilities and API
├── backend/           # FastAPI backend
│   ├── api/           # API routes
│   └── engine/        # Analysis engine
└── package.json       # Root configuration
```

## API Endpoints

### Stock Analysis
- `GET /api/v1/health` - Health check
- `GET /api/v1/dashboard` - Dashboard data
- `POST /api/v1/analyze` - Analyze stock

### Financial Ledger
- `POST /api/ledger/upload` (Next.js) - Upload bank statement (.xlsx / .xls / .xlsm / .xlsb / .csv / .txt / .pdf — any Indian retail bank, credit card, or UPI export). Parsed + categorized by the TypeScript engine in `frontend/lib/ledger/`.

## Environment Variables

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8765/api/v1
```
