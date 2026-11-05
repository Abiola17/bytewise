# Bytewise

AI debugging assistant: **source evidence → AI diagnosis → minimal patch → human approval → real verification.**

**New here? Read the [user guide](docs/user-guide.md)** — a step-by-step walkthrough of the app.


## Requirements

- Node.js 22+
- pnpm 9 (`npm install -g pnpm@9`)

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in META_API_KEY / BASETEN_API_KEY
```

## Run

```bash
pnpm dev          # server on :4000 and web on :3000
pnpm dev:server   # server only
pnpm dev:web      # web only
```

The SQLite database is created at `.data/bytewise.db` and migrated automatically on server start.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

End-to-end browser test of the full loop (register → baseline test run → diagnosis →
patch → approve → passing run → dashboard). It uses the **real model** from `.env`
(no mocks), its own ports (3217/4217), its own database and a throwaway copy of the demo
in `.data/e2e/`, so it never touches `pnpm dev`, the dev database or `examples/`:

```bash
pnpm exec playwright install chromium   # once
pnpm test:e2e
```

## Layout

| Path              | What                                                         |
| ----------------- | ------------------------------------------------------------ |
| `apps/web`        | Next.js + React + Tailwind frontend (display only)           |
| `apps/server`     | Fastify + TypeScript backend (all state, security, AI calls) |
| `packages/shared` | Zod schemas and types shared by both apps                    |
| `examples/`       | Projects Bytewise can debug (not part of the pnpm workspace) |

## Environment

| Variable                        | Default                       | Purpose                                        |
| ------------------------------- | ----------------------------- | ---------------------------------------------- |
| `MODEL_PROVIDER`                | `meta`                        | `meta` or `baseten`                            |
| `META_API_KEY`                  | —                             | Meta API key (server only)                     |
| `BASETEN_API_KEY`               | —                             | Baseten API key (server only)                  |
| `META_MODEL`                    | `muse-spark-1.3`              | Meta model id                                  |
| `BASETEN_MODEL`                 | `meta-models/muse-spark-open` | Baseten model id                               |
| `MODEL_TIMEOUT_MS`              | `120000`                      | Model request timeout                          |
| `VERIFICATION_TIMEOUT_MS`       | `120000`                      | Test run time limit                            |
| `VERIFICATION_MAX_OUTPUT_CHARS` | `64000`                       | Output kept per stream                         |
| `SERVER_PORT`                   | `4000`                        | API port                                       |
| `WEB_ORIGIN`                    | `http://localhost:3000`       | Allowed CORS origin                            |
| `DATABASE_PATH`                 | `.data/bytewise.db`           | SQLite file, relative to repo root             |
| `SCREENSHOTS_DIR`               | `.data/screenshots`           | Uploaded screenshot images                     |
| `PROJECTS_DIR`                  | `examples`                    | Only directory projects may be registered from |
| `NEXT_PUBLIC_API_URL`           | `http://localhost:4000`       | Where the web app finds the API                |
