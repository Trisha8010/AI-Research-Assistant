# AI Research Assistant

Full-stack AI research assistant with RAG, multi-document analysis, knowledge graphs, and multi-key Gemini orchestration.

## Features

- **Document ingestion**: PDF, DOCX, images (OCR), TXT/MD/CSV
- **RAG pipeline**: FAISS + sentence-transformers embeddings, per-user isolation
- **Multi-key Gemini management**: rotation, cooldown on quota/429, model failover
- **Knowledge graph extraction** from answers
- **Optional web search** mode
- **Chat history & sessions** with auth
- **Frontend**: Next.js, Mermaid diagrams, force-graph visualization, voice helper

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env and add at least one Gemini API key
# Prefer multiple keys: GOOGLE_API_KEYS=key1,key2,key3

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## API key resilience

The backend includes a `KeyManager` that:

- Accepts multiple Gemini keys via `GOOGLE_API_KEYS` (comma-separated)
- Rotates keys on each successful call
- Puts a key+model pair on a 5-minute cooldown after 429 / quota / resource_exhausted
- Retries with a short backoff when all keys are temporarily exhausted
- Exposes health via `GET /diagnostics`

When every key is exhausted the API returns a clear, actionable error instead of a generic failure.

## Project structure

```
AI-Research-Assistant/
├── backend/
│   ├── main.py              # FastAPI app + auth + endpoints
│   ├── rag_engine.py        # RAG, indexing, generation
│   ├── key_manager.py       # Multi-key rotation + exhaustion handling
│   ├── models.py            # SQLAlchemy models
│   └── requirements.txt
└── frontend/                # Next.js app
```

## Challenge note

This repository is intended as a realistic target for analysis tools (clear business workflow, multi-component risks around API quotas, indexing, and user isolation).
