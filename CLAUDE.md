# Bytewise — notes for AI coding assistants

Product brief and phase plan: `implementation.md`. Read the relevant phase before starting work.

## Commands

- `pnpm dev` — server (:4000) + web (:3000)
- `pnpm typecheck && pnpm lint && pnpm test` — run before reporting a phase complete
- `pnpm test:e2e` — Playwright full-loop test with the real model on ports 3217/4217 (own DB + temp demo copy in `.data/e2e`)
- `pnpm db:generate` — after changing `apps/server/src/database/schema.ts`; commit the generated migration

## Structure

- `apps/vscode` — **the current focus**: the Bytewise VS Code extension (see `implementation.md` §19A). Extension host code in `src/` (no VS Code imports in `meta/` and `chat-session.ts`, so they unit-test with Vitest); the chat webview in `src/webview/` renders model text via DOM nodes only (never innerHTML) under a strict CSP. The Meta key lives in `context.secrets` and never reaches the webview. Commands: `pnpm ext:build`, `pnpm ext:test` (unit + real VS Code smoke test), `pnpm ext:package` (→ `apps/vscode/dist/bytewise.vsix`). F5 → “Run Bytewise Extension”.

- `apps/server` — Fastify, TypeScript only. Layers: `routes/` (HTTP + Zod parsing only) → `services/` (logic) → `repositories/` (Drizzle). Errors are thrown as `AppError` and mapped to the shared `ApiError` body.
- `apps/web` — Next.js App Router. All backend calls go through `src/lib/api-client.ts`, which validates responses with shared schemas.
- `packages/shared` — Zod schemas = the API contract. Change the contract here first. Use extensionless relative imports (Next.js cannot resolve `.js` → `.ts`).
- `examples/` — external projects under inspection; not workspace packages.

## Non-negotiable rules

- Never fabricate evidence, diagnoses, file paths, line numbers or test results. No mock/fake AI responses.
- Model output is untrusted: validate with Zod; never execute model-suggested commands.
- Patch approval and all security checks are enforced in the backend, not only the UI.
- Project paths must resolve inside `PROJECTS_DIR`; never return absolute paths to the client.
- API keys are read only by `apps/server` from the root `.env`; never expose them via `NEXT_PUBLIC_*`, logs or responses. `.env` must never be committed.
- Models: `muse-spark-1.3` for diagnosis, chat and patches (the Meta API has no separate Muse Code model); `muse-voice-transcribe-1.0` and `sam-3.1` are optional (Phase 7). Providers: `meta` | `baseten`, behind the `ModelProvider` interface in `apps/server/src/providers/`.
- Patches: the model returns exact find/replace edits; `patch-builder.ts` validates them (find must occur exactly once, no new files, no test/package.json/lockfile edits, size limits). Files are written only via `approve` → `writeFilesAtomically` after re-checking content hashes. Status changes go through `patches.transition(id, from, to)` so they can't happen twice.
- Verification: only package.json scripts matching `test|test:*|typecheck|lint|check` run (`execution/command-policy.ts`), via `execution/process-runner.ts` — no shell, stripped env (no API keys), own process group killed on timeout, capped output. `passed` means exit code 0 and nothing else. Runs are async (202 + poll); never report a result the process did not produce.
- Live checks that apply patches must use a temp copy of `examples/` (set `PROJECTS_DIR`), so the demo bug stays in place.
- Voice (`providers/meta/meta.transcription.ts`, native realtime WebSocket protocol) and screenshots (`providers/meta/meta.segmentation.ts`, SAM 3.1 via `/v1/responses`) are Meta-only. A transcript only fills the message box — it is never sent automatically. Uploaded images are validated by their own bytes (`filesystem/image-info.ts`), not the declared MIME type.
- Tests must never call a real model API: pass test providers to `createTestApp({ modelProvider, transcriptionProvider, segmentationProvider })` (the defaults throw).
- The user often has `pnpm dev` running. Verify web builds with `pnpm --filter @bytewise/web build:check` (separate `.next-check` dir) — plain `next build` corrupts a running dev server.
