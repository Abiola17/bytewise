# Bytewise — Project Brief & Implementation Context

## 1. Project Overview

**Project name:** Bytewise  
**Product category:** AI-powered developer assistant  
**Project context:** Meta AI Developer Hackathon  
**Primary goal:** Build an AI teammate that helps developers investigate software bugs, understand their codebase, generate safe code changes, and verify those changes with real test results.

Bytewise is not intended to be a generic chatbot that simply answers programming questions. It should operate as a structured debugging and code-improvement workflow that connects AI reasoning to actual project files, proposed code changes, and verifiable execution results.

The product should help developers move from:

**Problem → Investigation → Evidence → Proposed Fix → Approval → Verification**

The application must make it clear what the AI believes, which project evidence supports that belief, what code it proposes to change, and whether the proposed change actually works.

The first version should be a polished, functional MVP that demonstrates this complete workflow for a small, supported codebase.

---

## 2. Product Vision

Developers frequently spend significant time investigating errors, tracing behavior across files, understanding unfamiliar code, and validating potential fixes.

Bytewise aims to reduce this effort by combining project-aware code analysis with a controlled, human-approved code modification workflow.

The application should feel like a focused developer workspace containing:

- A project overview and project file explorer.
- An AI debugging conversation.
- Relevant source-code evidence.
- A diagnosis panel showing the likely cause of a problem.
- A code-diff viewer for proposed fixes.
- An approval step before modifying files.
- A test execution and verification panel.
- A compact history of debugging sessions and their outcomes.
- Useful visual summaries of test results and debugging activity.

The interface should prioritize clarity, trust, and usability over unnecessary complexity.

## 3. Core Product Principles

### 3.1 Evidence before conclusions

The AI should inspect relevant project context before making a diagnosis. When possible, explanations should reference specific files, functions, line ranges, error messages, or test failures.

The interface must distinguish between:

- **Observed evidence:** Information directly found in source files, logs, or test results.
- **AI hypothesis:** A possible explanation inferred from that evidence.
- **Verified result:** An outcome confirmed by an actual executed test or operation.

The application must never present an unverified hypothesis as a proven root cause.

### 3.2 Human approval before code changes

The AI can propose changes, but the user must explicitly approve a patch before the application applies it.

The initial version must not autonomously modify project files, execute unrestricted shell commands, or silently change application behavior.

### 3.3 Verification is part of the product

Generating a patch is not the end of a debugging session.

After approval and application, Bytewise should run an allowed verification command, capture its actual output, and communicate whether the result passed, failed, or could not be completed.

### 3.4 Minimal, focused changes

Prefer the smallest reasonable patch that addresses the identified problem. Avoid broad rewrites, unrelated refactoring, or unnecessary dependency changes.

### 3.5 Clear communication

The product should explain technical issues in accessible language while retaining enough technical detail for experienced developers to inspect and challenge its reasoning.

---

## 4. Target Users

The primary users are:

- Software developers investigating bugs.
- Hackathon participants building and debugging applications.
- Developers learning an unfamiliar codebase.
- Small engineering teams that need a lightweight debugging assistant.

The MVP should focus on developers working with small TypeScript or JavaScript projects. The architecture should permit additional languages later without requiring an immediate multi-language implementation.

---

## 5. MVP Scope

The following capabilities define the first usable version.

### Feature 1: Project onboarding

Allow a user to select or open a supported local project through the configured development environment.

The project onboarding flow should:

1. Identify the project root.
2. Read a bounded list of project files.
3. Detect relevant metadata, such as `package.json`, TypeScript configuration, and available test scripts.
4. Display a project summary.
5. Exclude sensitive or irrelevant directories and files.
6. Allow the user to start a debugging session.

The initial deployment may operate against a preconfigured sample repository if unrestricted local filesystem access is not available in the target environment.

Do not imply that a browser-only frontend can access arbitrary files on the user's computer. Project access must be implemented through an explicit local development service, backend integration, or supported file-upload workflow.

### Feature 2: AI debugging conversation

Provide a conversational interface where the developer can describe a bug, ask about code behavior, or request help understanding an error.

Example request:

> The login endpoint returns a 500 error when a user submits valid credentials. Investigate the cause and propose a fix.

The AI workflow should:

1. Interpret the request.
2. Identify what evidence is needed.
3. Retrieve relevant project files and test information.
4. Submit bounded context to the configured Meta AI model.
5. Return a diagnosis with supporting evidence.
6. Ask for clarification if the available evidence is insufficient.

The conversation should remain linked to the active project and debugging session.

### Feature 3: Project context and evidence retrieval

Implement a context service that gathers relevant project information for each request.

The service should support:

- File and directory discovery.
- File content retrieval.
- Filename and symbol searches.
- Error-message and stack-trace searches.
- Test failure and configuration inspection.
- Relevant package and dependency metadata.

For the MVP, use straightforward, reliable techniques first: directory traversal with exclusions, text search, targeted file reads, and bounded context selection.

Do not introduce a vector database unless testing demonstrates a concrete need.

The context engine must return structured evidence containing, where available:

- Relative file path.
- Relevant line range.
- Excerpt.
- Evidence type.
- Reason the evidence is relevant.

The system should enforce file-size, result-count, and total-context limits.

### Feature 4: Diagnosis and explanation

Display the AI's proposed diagnosis in a dedicated panel.

A diagnosis should contain:

- **Summary:** A concise explanation of the suspected problem.
- **Likely cause:** The most plausible explanation based on available evidence.
- **Supporting evidence:** References to relevant project files, logs, or test failures.
- **Confidence or uncertainty:** A qualitative indication where useful, without pretending to have calibrated probabilities.
- **Suggested fix:** A brief explanation of the intended change.
- **Limitations:** Any missing information or unverified assumptions.

Evidence references must correspond to actual retrieved project content. Do not fabricate file paths, line numbers, logs, or test outcomes.

### Feature 5: Proposed patch and diff viewer

Generate a proposed code patch and display it before applying any change.

The patch experience should include:

- Changed file list.
- Added and removed lines.
- Syntax-highlighted diff where supported.
- Explanation of the changes.
- Apply patch action.
- Reject patch action.
- Clear indication of which files will be modified.

Validate every proposed file path against the allowed project root. Reject absolute paths, path traversal, unexpected file creation, and other changes that violate patch policy.

The user must explicitly approve the proposed patch.

If the patch is rejected, no project files should be modified.

If the patch is malformed or cannot be safely applied, show an actionable error instead of silently continuing.

### Feature 6: Controlled patch application

After approval:

1. Revalidate the patch against the current file contents.
2. Check that the files have not changed unexpectedly since the patch was generated.
3. Apply the approved changes.
4. Record which files were changed.
5. Preserve enough information to show the diff and, where feasible, support reverting the applied patch.
6. Report success or failure to the frontend.

Patch application must be atomic where practical. Never treat a partially applied patch as a complete success.

### Feature 7: Test execution and verification

After a patch is successfully applied, allow the user to run the project's approved test command.

For the MVP, support explicitly configured commands such as:

- A project-specific test script.
- A configured type-check command.
- A configured lint command, if appropriate.

Do not accept arbitrary AI-generated shell commands without validation.

The execution service should capture:

- Command or configured script name.
- Start and completion time.
- Exit code.
- Standard output.
- Standard error.
- Duration.
- Final status.

Use clear result states:

- `passed`
- `failed`
- `timed_out`
- `blocked`
- `error`
- `not_run`

Only report a passing test when the process actually completed successfully and its exit status supports that conclusion.

If verification fails, allow the user to return to investigation, inspect the output, and request another diagnosis.

### Feature 8: Session history

Store enough information to revisit recent debugging sessions.

A session should retain:

- User request.
- Relevant conversation messages.
- Diagnosis.
- Evidence references.
- Proposed patch metadata.
- Approval and application status.
- Verification runs and results.
- Timestamps.

Avoid storing full source files or sensitive project contents unnecessarily.

### Feature 9: Dashboard and charts

Provide a small, useful overview of project and debugging activity.

The dashboard may include:

- Total debugging sessions.
- Sessions with verified fixes.
- Test runs passed versus failed.
- Recent debugging activity.
- A short timeline of verification outcomes.

Use a lightweight chart library such as Recharts if charts materially improve the interface.

Charts must be based on real session and test-run data returned by the backend. Do not generate sample values in the production interface or imply that a chart proves code correctness.

For the MVP, simple summary cards, a recent activity list, and one compact test-result chart are sufficient. Avoid building a large analytics system.

---

## 6. Recommended Technology Stack

Use the following stack unless the existing repository or hackathon requirements require a documented adjustment.

### Frontend

- **Next.js** — Application framework.
- **React** — Component-based user interface.
- **TypeScript** — Type safety across frontend components.
- **Tailwind CSS** — Styling and responsive layouts.
- **shadcn/ui** — Reusable interface components.
- **Monaco Editor** — Code viewing and diff presentation.
- **Recharts** — Lightweight dashboard visualizations where useful.
- **Zod** — Client-side validation and shared schema definitions where appropriate.

The frontend should be responsive and visually consistent. Use a focused developer-workspace layout rather than a generic chatbot landing page.

### Backend

- **Node.js** — Runtime.
- **TypeScript** — Required backend language.
- **Fastify** — HTTP server and API framework (Node.js framework with first-class TypeScript support).
- **Zod** — Request and response validation.
- **SQLite** — Initial persistent application database.
- **Drizzle ORM** — Typed database access and migrations.

Keep the backend modular. HTTP handlers should not directly contain all model calls, filesystem operations, patching logic, or process execution logic.

### AI integration

- The official Meta models supported by the hackathon (see Section 11.1): **Muse Spark 1.3** (core; also covers the Muse Code role), **Muse Voice Transcribe**, and **SAM 3.1**.
- Two hosting providers, selected with `MODEL_PROVIDER`: `meta` (Meta's API, `META_API_KEY`) or `baseten` (Baseten-hosted, `BASETEN_API_KEY`).
- A dedicated provider adapter that isolates model-specific integration.
- Structured input and output validation using Zod.
- Explicit context-size limits and error handling.

Before implementing the provider integration, confirm the actual model name, SDK, authentication method, supported inputs and outputs, context limits, and hackathon usage requirements.

Do not assume that the model supports native tool calling, structured-output enforcement, vision, or a particular API format unless the selected model's documentation confirms it.

### Code and test execution

- Node.js child-process APIs or an equivalent controlled execution mechanism.
- Explicit command allowlists.
- Process timeouts and output limits.
- A restricted working directory.
- A sandbox or isolated execution environment where available.

A normal web server is not, by itself, a security sandbox. Do not run untrusted project code on the application host with unrestricted filesystem or network permissions.

### Testing and quality

- Vitest for unit and service tests.
- Playwright for important end-to-end workflows.
- ESLint for linting.
- TypeScript strict mode.
- Automated formatting and type checking.

### Package management

Use the package manager already present in the repository. If starting from scratch, use `pnpm` workspaces to manage the frontend, backend, and shared types.

---

## 7. High-Level Architecture

Organize the application into clear layers.

```text
┌───────────────────────────────────────────────────┐
│                 Next.js Frontend                  │
│                                                   │
│ Project View │ AI Chat │ Evidence │ Patch Diff    │
│ Verification │ Session History │ Dashboard Charts │
└────────────────────────┬──────────────────────────┘
                         │ HTTP API
┌────────────────────────▼──────────────────────────┐
│             TypeScript Backend (Fastify)           │
│                                                   │
│ API Routes │ Validation │ Session Orchestration    │
└───────────────┬──────────────────┬────────────────┘
                │                  │
┌───────────────▼────────┐  ┌──────▼────────────────┐
│ Project Context Engine │  │ Meta Model Adapter     │
│                        │  │                        │
│ File Discovery         │  │ Prompt Construction    │
│ Text Search            │  │ Model Requests         │
│ Evidence Extraction    │  │ Response Validation    │
│ Context Budgeting      │  │ Diagnosis / Patch Plan │
└───────────────┬────────┘  └────────┬───────────────┘
                │                    │
                └──────────┬─────────┘
                           │
┌──────────────────────────▼────────────────────────┐
│             Controlled Action Services            │
│                                                   │
│ Patch Validation │ User Approval │ Patch Apply    │
│ Test Runner │ Execution Limits │ Result Capture   │
└──────────────────────────┬────────────────────────┘
                           │
             ┌─────────────▼────────────┐
             │ SQLite + Project Workspace│
             │ Sessions, Runs, Metadata  │
             │ Source Files, Test Output │
             └───────────────────────────┘
```

### Architecture rules

1. The frontend must never receive model credentials or privileged filesystem capabilities.
2. The backend is responsible for validating every request.
3. Project context retrieval must be separate from model communication.
4. Model output is untrusted input and must be validated.
5. Patch application and process execution must be separate services.
6. Approval state must be checked on the backend, not merely enforced by hiding a frontend button.
7. Persistent records must reflect actual events, not optimistic UI assumptions.
8. The model must not receive unrestricted access to arbitrary backend tools.

---

## 8. Recommended Repository Structure

Use a monorepo with a frontend, backend, and shared package.

```text
bytewise/
├── apps/
│   ├── web/
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── projects/
│   │   │   │   ├── sessions/
│   │   │   │   └── api/                 # Only if Next.js API routes are needed
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   ├── project/
│   │   │   │   ├── chat/
│   │   │   │   ├── evidence/
│   │   │   │   ├── diagnosis/
│   │   │   │   ├── patches/
│   │   │   │   ├── verification/
│   │   │   │   ├── dashboard/
│   │   │   │   └── ui/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   └── formatters.ts
│   │   │   ├── types/
│   │   │   └── styles/
│   │   ├── tests/
│   │   ├── next.config.ts
│   │   └── package.json
│   │
│   └── server/
│       ├── src/
│       │   ├── app.ts
│       │   ├── server.ts
│       │   ├── config/
│       │   ├── plugins/
│       │   ├── routes/
│       │   │   ├── health.routes.ts
│       │   │   ├── projects.routes.ts
│       │   │   ├── sessions.routes.ts
│       │   │   ├── chat.routes.ts
│       │   │   ├── patches.routes.ts
│       │   │   ├── verification.routes.ts
│       │   │   └── dashboard.routes.ts
│       │   ├── services/
│       │   │   ├── project.service.ts
│       │   │   ├── session.service.ts
│       │   │   ├── debugging.service.ts
│       │   │   ├── context.service.ts
│       │   │   ├── evidence.service.ts
│       │   │   ├── diagnosis.service.ts
│       │   │   ├── patch.service.ts
│       │   │   ├── approval.service.ts
│       │   │   ├── verification.service.ts
│       │   │   └── dashboard.service.ts
│       │   ├── providers/
│       │   │   ├── model-provider.ts        # ModelProvider interface + role → model mapping
│       │   │   ├── meta/
│       │   │   │   ├── meta.provider.ts
│       │   │   │   ├── meta.client.ts
│       │   │   │   └── meta.schemas.ts
│       │   │   └── baseten/
│       │   │       ├── baseten.provider.ts
│       │   │       └── baseten.client.ts
│       │   ├── repositories/
│       │   ├── execution/
│       │   │   ├── command-policy.ts
│       │   │   ├── process-runner.ts
│       │   │   └── sandbox.ts
│       │   ├── filesystem/
│       │   │   ├── project-root.ts
│       │   │   ├── file-discovery.ts
│       │   │   ├── file-reader.ts
│       │   │   ├── text-search.ts
│       │   │   └── path-policy.ts
│       │   ├── database/
│       │   │   ├── client.ts
│       │   │   ├── schema.ts
│       │   │   └── migrations/
│       │   ├── schemas/
│       │   ├── middleware/
│       │   ├── utils/
│       │   └── errors/
│       ├── tests/
│       └── package.json
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── schemas/
│       │   ├── types/
│       │   ├── constants/
│       │   └── index.ts
│       └── package.json
│
├── examples/
│   └── broken-login-app/
│
├── docs/
│   ├── architecture.md
│   └── security.md
│
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
└── PROJECT_BRIEF.md
```

This is a target structure, not a requirement to create empty files for every module immediately. Implement modules as they become necessary, while preserving the architectural boundaries.

Do not run a second backend inside Next.js unless there is a clear reason. Use Fastify as the primary backend API.

---

## 9. Frontend Experience and Layout

### 9.1 Main application shell

Create a polished developer workspace with three main areas:

1. **Navigation sidebar:** Project selection, recent sessions, and navigation.
2. **Primary workspace:** Chat, project files, evidence, and patch review.
3. **Context panel:** Diagnosis, relevant source references, and verification status.

The layout should adapt to smaller screens. On narrower displays, context panels can become tabs or collapsible drawers.

The interface should have a coherent design system with consistent spacing, typography, colors, borders, and loading states.

Use dark-mode styling if it suits the developer-workspace experience, but maintain strong contrast and readable code.

### 9.2 Main dashboard

The dashboard should present:

- Active project.
- A clear action to start a debugging session.
- Recent sessions.
- Summary cards for session count, successful verifications, and failed test runs.
- A compact test outcome chart.
- Recent activity with timestamps and statuses.

Do not overcrowd the initial screen. The main action should be obvious.

### 9.3 Project explorer

Show the selected project's supported files and directories.

Users should be able to select a file and inspect its contents in a read-only code viewer.

Exclude dependency directories, build output, version-control internals, secrets, and other prohibited files from discovery and display.

### 9.4 Chat interface

The chat should support:

- User messages.
- Assistant responses.
- Loading and error states.
- References to evidence.
- Links or actions to inspect relevant files.
- A clear transition from diagnosis to proposed patch.

Do not render raw model output as trusted HTML. Treat responses as text or validated structured content.

### 9.5 Evidence panel

Each evidence item should show:

- Relative file path or source label.
- Line range, if known.
- Short code or log excerpt.
- Why it matters to the diagnosis.

Selecting an evidence item should open the relevant file or excerpt when available.

### 9.6 Diagnosis panel

Show the diagnosis summary, suspected cause, evidence references, uncertainty, and proposed next step.

Use explicit labels so that a developer can distinguish an AI-generated hypothesis from verified execution results.

### 9.7 Diff viewer

Use Monaco's diff capabilities or a suitable diff component to display before-and-after code.

The patch review should show the exact files and changes included in the approval.

Place **Apply patch** and **Reject patch** actions near the diff. The application must confirm patch state with the backend after each action.

### 9.8 Verification panel

Display the actual result of a test run:

- Status.
- Command or script name.
- Duration.
- Exit code.
- Standard output and standard error.
- Failure details, when applicable.

Use clear status labels and icons, but do not communicate success using color alone.

### 9.9 Charts and visualizations

Use Recharts for a small number of data-backed visualizations if appropriate.

Suggested MVP charts:

- Test runs by outcome.
- Recent verification outcomes over time.

All chart data must come from backend aggregation endpoints.

Handle empty states gracefully. If there is no session history, show a helpful prompt instead of a misleading empty chart.

---

## 10. Backend Responsibilities

The backend is the authoritative layer for application state, project access, model requests, patch handling, and verification.

### 10.1 Project service

Responsibilities:

- Register a project.
- Validate and resolve its root directory.
- Read basic project metadata.
- Return a safe project summary.
- Enforce project access rules.

### 10.2 Context service

Responsibilities:

- Discover relevant files.
- Search file contents.
- Collect stack traces and relevant test output.
- Build bounded evidence records.
- Exclude prohibited content.
- Rank evidence by relevance.
- Prepare the limited context sent to the model.

The context service should not send an entire repository to the model by default.

### 10.3 Model provider service

Responsibilities:

- Construct model requests.
- Use the official Meta-supported integration.
- Validate model responses.
- Apply request timeouts and error handling.
- Normalize provider-specific output into application-level schemas.

Keep provider-specific SDK details inside the provider module. The rest of the application should not depend directly on SDK-specific response formats.

### 10.4 Debugging orchestration service

Coordinate the workflow:

1. Accept the developer's request.
2. Retrieve project context.
3. Call the model with the relevant evidence.
4. Validate the diagnosis.
5. Store the response and evidence references.
6. Generate a proposed patch when requested and supported.
7. Return a structured response to the frontend.

Avoid putting the entire workflow into a single large route handler.

### 10.5 Patch service

Responsibilities:

- Validate patch structure.
- Restrict target paths to the active project.
- Validate the expected original file state.
- Generate a diff.
- Require explicit approval.
- Apply the approved patch.
- Record application results.

The service must reject any attempt to bypass the approval state.

### 10.6 Verification service

Responsibilities:

- Resolve a test script from the project's validated configuration.
- Check it against the execution policy.
- Start a restricted process.
- Enforce timeouts and output limits.
- Capture actual process results.
- Store the verification record.
- Return a normalized result to the frontend.

### 10.7 Dashboard service

Aggregate real database records into summary metrics for the dashboard and charts.

Keep aggregation logic on the backend so that charts use a consistent definition of session and verification statuses.

---

## 11. Meta AI Integration Design

The selected Meta model is an important dependency and must be integrated behind a provider interface.

Create an application-level interface conceptually similar to:

```ts
export interface ModelProvider {
  diagnose(input: DiagnosisInput): Promise<DiagnosisResult>;
  proposePatch(input: PatchProposalInput): Promise<PatchProposalResult>;
}
```

The exact types should be implemented in the shared schemas package or backend schema module, depending on the ownership of the contract.

These are application-level abstractions, not claims about the official Meta SDK's actual method names.

### 11.1 Meta models used in Bytewise

| Meta model | API model id | Role in Bytewise | Priority |
|---|---|---|---|
| **Muse Spark 1.3** | `muse-spark-1.3` | Diagnosis from evidence, clarifying questions, chat replies, and (Phase 4) patch proposals. Meta describes it as its model for coding and agentic workflows. | Required (core loop) |
| **Muse Code** | — | Not exposed by the Meta Model API (verified 2026-11-04 via `GET /v1/models`). Its code role is served by `muse-spark-1.3`. | n/a |
| **Muse Voice Transcribe** | `muse-voice-transcribe-1.0` | Optional voice input: the developer dictates a bug report, which is transcribed into the chat box for review before it is sent. | Optional (Phase 7) |
| **SAM 3.1** | `sam-3.1` | Optional visual evidence: segmenting a user-uploaded screenshot of a UI bug to highlight the affected region. Not used for code reasoning. | Stretch goal |

The model is configurable per provider (`META_MODEL`, `BASETEN_MODEL`). Do not default to `-contributor` model variants: they allow Meta to train on prompts, which contain the user's source code.

**Verified API facts — voice and segmentation (2026-11-04):**

- **Muse Voice Transcribe** is realtime-only: WebSocket `wss://api.meta.ai/v1/asr/realtime`. First text frame: `{"authorization":{"accessToken":"<META_API_KEY>"},"mode":"ENDPOINTING","audioEncoding":"PCM_24KHZ","model":"muse-voice-transcribe-1.0","partialMode":"CUMULATIVE"}`; the server answers `{"sessionId":...}`. Then binary frames of raw PCM16 mono 24 kHz, then `{"type":"endStream"}`. Final text per turn arrives as `{"type":"speechComplete","transcript":...}`; the socket closes with 1000. Sending at 2× real time kept accuracy; 8× did not. The OpenAI-style `session.update` protocol is rejected (`audioEncoding` required).
- **SAM 3.1**: `POST /v1/responses`, `model: "sam-3.1"`, one user message with an `input_text` noun phrase and an `input_image` whose `image_url` may be a base64 `data:` URL. Output text contains `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>` tokens (plus mask payloads, which Bytewise ignores). Empty output means no match. Concrete nouns work ("button", "text box"); abstract phrases ("warning", "banner") return nothing.

**Verified API facts (Meta):** base URL `https://api.meta.ai/v1`, `Authorization: Bearer <META_API_KEY>`, OpenAI-compatible `POST /chat/completions`, `response_format: { type: "json_schema", strict: true }` supported (including nullable fields), `max_completion_tokens` and `reasoning_effort` supported, no streaming on Chat Completions. Baseten hosts `meta-models/muse-spark-open` at `https://inference.baseten.co/v1`.

Before integrating each model, confirm from the official documentation its exact model identifier on each provider, request format, context limits, and whether it supports structured output. Do not assume both providers expose identical APIs.

### 11.2 Providers and environment

The `.env` file at the repository root holds the configuration:

| Variable | Purpose |
|---|---|
| `MODEL_PROVIDER` | `meta` or `baseten` — which hosting provider the adapter uses. |
| `META_API_KEY` | Credential for Meta's API. Server-side only. |
| `BASETEN_API_KEY` | Credential for Baseten-hosted models. Server-side only. |

Rules:

- `.env` must be listed in `.gitignore` and never committed. Commit a `.env.example` with variable names and empty values.
- Only `apps/server` reads these variables. Never expose them through Next.js public environment variables.
- Implement one adapter per provider (`providers/meta/`, `providers/baseten/`) behind the same `ModelProvider` interface.

### Provider requirements

- Read credentials from environment variables or the officially supported authentication mechanism.
- Never expose secrets to the browser.
- Use the official model and API specified by the hackathon.
- Apply timeouts and handle provider failures.
- Enforce bounded prompts and source context.
- Validate responses against application schemas.
- Treat generated code, paths, and commands as untrusted proposals.
- Provide useful errors if the provider is unavailable.
- Keep model selection configurable when permitted by the hackathon.

### Structured model results

A diagnosis result should be normalized to a structure conceptually containing:

```ts
interface DiagnosisResult {
  summary: string;
  likelyCause: string;
  evidenceIds: string[];
  uncertainty?: string;
  suggestedFix?: string;
}
```

A patch proposal should contain structured file changes or a well-defined patch representation, along with an explanation.

The implementation must validate the actual returned data rather than assuming the model will always follow the requested schema.

Do not allow the model to apply patches or execute commands directly.

If the provider returns invalid or incomplete data, request a safe retry where appropriate or report that the response could not be processed.

---

## 12. API Design

Use versioned REST endpoints under `/api/v1`.

The following is a proposed initial contract. Adjust request and response fields to the shared Zod schemas as implementation develops.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/projects` | List registered projects |
| POST | `/api/v1/projects` | Register a project |
| GET | `/api/v1/projects/:projectId` | Get project metadata |
| GET | `/api/v1/projects/:projectId/files` | List safe project files |
| GET | `/api/v1/projects/:projectId/files/content` | Read a validated file |
| GET | `/api/v1/projects/:projectId/sessions` | List project sessions |
| POST | `/api/v1/projects/:projectId/sessions` | Create a session |
| GET | `/api/v1/sessions/:sessionId` | Get session details |
| POST | `/api/v1/sessions/:sessionId/messages` | Submit a debugging request |
| POST | `/api/v1/sessions/:sessionId/diagnose` | Request a diagnosis |
| POST | `/api/v1/sessions/:sessionId/patch-proposals` | Generate a patch proposal |
| GET | `/api/v1/patches/:patchId` | Retrieve patch and diff metadata |
| POST | `/api/v1/patches/:patchId/approve` | Approve and apply a patch |
| POST | `/api/v1/patches/:patchId/reject` | Reject a patch |
| POST | `/api/v1/sessions/:sessionId/verifications` | Start a permitted test run |
| GET | `/api/v1/verifications/:verificationId` | Retrieve a verification result |
| GET | `/api/v1/dashboard/summary` | Retrieve summary metrics |
| GET | `/api/v1/dashboard/test-outcomes` | Retrieve chart data |

Important implementation notes:

- Validate every request and response.
- Use consistent error formats.
- Check project and session ownership or access permissions.
- Return appropriate HTTP status codes.
- Make long-running operations report their actual state.
- If execution becomes asynchronous, return an operation identifier and expose a polling endpoint.
- Prevent duplicate patch applications and duplicate execution requests where appropriate.
- Do not rely on client-provided status fields as authoritative.

The frontend API client should be centralized rather than scattering raw `fetch` calls throughout components.

---

## 13. Initial Data Model

Use SQLite with Drizzle ORM for the initial implementation.

### Project

Represents a registered project.

Suggested fields:

- `id`
- `name`
- `rootPath` or a safe workspace identifier
- `language`
- `metadataJson`
- `createdAt`
- `updatedAt`

Avoid exposing absolute filesystem paths unnecessarily.

### DebugSession

Represents one debugging task.

Suggested fields:

- `id`
- `projectId`
- `title`
- `status`
- `createdAt`
- `updatedAt`

### Message

Stores the conversation associated with a session.

Suggested fields:

- `id`
- `sessionId`
- `role`
- `content`
- `createdAt`

### Evidence

Stores references to relevant project information.

Suggested fields:

- `id`
- `sessionId`
- `sourceType`
- `relativePath`
- `startLine`
- `endLine`
- `excerpt`
- `description`
- `createdAt`

Store only the minimum source content required for the debugging session.

### PatchProposal

Represents a proposed code change.

Suggested fields:

- `id`
- `sessionId`
- `status`
- `explanation`
- `patchPayload`
- `createdAt`
- `approvedAt`
- `appliedAt`
- `rejectedAt`
- `applicationResult`

Possible statuses include `proposed`, `approved`, `applied`, `rejected`, and `failed`.

The backend must control valid state transitions.

### VerificationRun

Represents a real test or check execution.

Suggested fields:

- `id`
- `sessionId`
- `patchId`
- `commandLabel`
- `status`
- `exitCode`
- `stdout`
- `stderr`
- `durationMs`
- `startedAt`
- `completedAt`

Limit the amount of output retained. Avoid storing secrets or unnecessary sensitive logs.

Use database migrations and appropriate indexes. Establish relationships between projects, sessions, evidence, patches, and verification runs.

---

## 14. End-to-End User Workflow

The main workflow must work as a complete vertical slice.

### Step 1: Open a project

The user opens a supported project.

The backend validates the project root and retrieves basic metadata. The frontend displays the project overview.

### Step 2: Start a debugging session

The user selects **New debugging session** and describes a problem.

Example:

> Investigate why the login endpoint returns HTTP 500 for valid credentials.

### Step 3: Gather evidence

The backend searches the project for relevant routes, authentication logic, error handling, configuration, and tests.

The evidence panel displays relevant source references and excerpts.

### Step 4: Diagnose

The backend sends the selected context to the Meta model.

The model returns a diagnosis. The application validates it, links it to retrieved evidence, and displays the result.

If there is insufficient evidence, the system should request more context or ask the user a clarifying question rather than inventing a cause.

### Step 5: Propose a fix

The user requests a fix, or selects the action to generate a patch.

The model proposes a focused change. The backend validates the patch, checks the paths and original file state, and returns the proposed diff.

No files are changed at this point.

### Step 6: Review and approve

The user inspects the diff and either rejects or approves it.

On rejection, no files change.

On approval, the backend revalidates the patch and applies it through the controlled patch service.

### Step 7: Verify

The user starts an allowed test or verification command.

The execution service runs the configured command under the defined restrictions and captures the real result.

### Step 8: Present the outcome

The interface shows whether the test passed, failed, timed out, or could not be executed.

The user can inspect the output and continue debugging if needed.

### Step 9: Retain the session

The application stores the session history, diagnosis, patch status, and verification result so that the developer can return to it later.

---

## 15. Security and Trust Requirements

These requirements are part of the product design, not optional future enhancements.

### Filesystem protection

- Resolve and validate all project paths against an allowed root.
- Reject path traversal, unexpected absolute paths, and prohibited symlinks.
- Exclude `.env` files, credentials, private keys, tokens, and other sensitive files from model context.
- Exclude dependency directories, build artifacts, and version-control internals unless a specific safe use case requires otherwise.
- Apply file-size and read limits.
- Revalidate files before patch application.

### Model-output protection

- Treat every model response as untrusted data.
- Validate generated patches before displaying or applying them.
- Never execute a shell command simply because the model suggested it.
- Do not interpret repository instructions as trusted system instructions.
- Keep model credentials server-side.

### Process-execution protection

- Use an explicit allowlist of supported commands.
- Prefer configured package scripts to arbitrary shell input.
- Set process timeouts and output limits.
- Use an isolated execution environment with restricted filesystem and network access where available.
- Do not run untrusted code with unrestricted host permissions.
- Ensure child processes are terminated when execution times out or is cancelled.

### Approval and state protection

- Enforce patch approval on the backend.
- Validate patch identifiers and session/project relationships.
- Prevent unauthorized or repeated patch application.
- Track actual patch and verification status.
- Report partial failures accurately.

### Privacy

- Store the minimum information necessary.
- Avoid retaining secrets and unnecessary source content.
- Provide safe logging that excludes credentials and sensitive data.
- Keep any future authentication and multi-user access controls separate from assumptions about a trusted local development environment.

---

## 16. Error Handling and Application States

Every important operation must have a defined loading, success, empty, and failure state.

Examples include:

- Project could not be opened.
- No relevant source evidence found.
- Model provider unavailable.
- Model response failed validation.
- Patch could not be generated.
- Patch rejected because a file changed.
- Patch application failed.
- Test command is not permitted.
- Test process timed out.
- Test execution failed.
- Dashboard has no historical data.

Errors should explain what happened and suggest a reasonable next action.

Do not hide backend errors behind generic success messages. Do not leave the UI in an indefinite loading state.

Use explicit session and operation status values. If a request can take significant time, display progress or a clear running state.

---

## 17. Implementation Phases

Build the project incrementally. Each phase should leave the application in a testable state.

### Phase 1: Foundation

- Initialize the monorepo.
- Configure Next.js, React, and TypeScript.
- Set up Tailwind CSS and shared UI components.
- Create the Fastify backend.
- Add shared schemas.
- Configure SQLite and Drizzle migrations.
- Add health-check and basic project APIs.
- Load and validate `.env` on the server (`MODEL_PROVIDER`, `META_API_KEY`, `BASETEN_API_KEY`); add `.gitignore` and `.env.example`.
- Build the initial application shell.

**Outcome:** The frontend and backend run locally and communicate successfully.

### Phase 2: Project context

- Implement safe project registration.
- Add file discovery and exclusions.
- Implement validated file reads and text search.
- Create evidence schemas and context budgeting.
- Display the project explorer and source excerpts.

**Outcome:** Bytewise can inspect a supported project without making changes.

### Phase 3: AI diagnosis

- Confirm the API details for Muse Spark on both providers (model identifiers, request format, limits). Done: see Section 11.1.
- Implement the `ModelProvider` interface and the `meta` and `baseten` adapters.
- Use Muse Spark 1.3 (`muse-spark-1.3`) for the chat conversation and diagnosis.
- Add prompt construction and output validation.
- Connect diagnosis to project context.
- Store debugging sessions and messages.
- Display diagnoses and supporting evidence.

**Outcome:** A developer can describe a problem and receive an evidence-grounded diagnosis.

### Phase 4: Patch proposals

- Define the patch representation.
- Generate patch proposals with Muse Spark 1.3 and validate them.
- Build the diff viewer.
- Implement approval and rejection flows.
- Validate paths and original file state.
- Apply approved patches safely.

**Outcome:** A developer can inspect and approve a proposed change before it is applied.

### Phase 5: Verification

- Implement the command policy.
- Add controlled process execution.
- Capture output, exit codes, and duration.
- Store verification runs.
- Build the verification panel.
- Support follow-up diagnosis after a failed test.

**Outcome:** The application can demonstrate an actual test result after an approved patch.

### Phase 6: Dashboard and polish

- Add summary aggregation endpoints.
- Build dashboard metrics and a compact chart.
- Add session history.
- Improve responsive layout and empty states.
- Add robust loading and error handling.
- Test the complete workflow end to end.

**Outcome:** The application is cohesive, demonstrable, and ready for a hackathon presentation.

### Phase 7: Multimodal input (optional)

Start only after Phases 1–6 are complete and the demo works end to end.

- Add voice bug reports with Muse Voice Transcribe: record in the browser, transcribe on the server, show the text for editing before sending.
- Stretch: accept a screenshot of a UI bug and use SAM 3.1 to highlight the affected region as a visual evidence item.

**Outcome:** Developers can report bugs by voice (and optionally screenshot) without weakening the evidence-to-fix loop.

---

## 18. MVP Acceptance Criteria

The MVP should not be considered complete until the following conditions are met.

### Project understanding

- [x] A supported project can be registered and inspected.
- [x] The application excludes sensitive and prohibited files.
- [x] Relevant source evidence can be retrieved and displayed.
- [x] File references correspond to actual project files.

### AI diagnosis

- [x] The selected Meta model is integrated through a backend adapter.
- [x] The application can submit a debugging request with bounded project context.
- [x] The diagnosis is validated before being displayed.
- [x] The interface separates evidence from hypotheses.
- [x] Provider errors are handled clearly.

### Patch workflow

- [x] The model can propose a focused code change.
- [x] The diff viewer shows the proposed changes.
- [x] Rejecting a patch leaves the project unchanged.
- [x] Applying a patch requires backend-enforced approval.
- [x] Unsafe paths and stale-file changes are rejected.
- [x] The application records the actual application outcome.

### Verification

- [x] Only permitted commands can be executed.
- [x] Timeouts and output limits are enforced.
- [x] Actual process results are captured.
- [x] The UI distinguishes pass, fail, timeout, and execution error.
- [x] The application never fabricates successful test results.

### Dashboard and sessions

- [x] Debugging sessions persist.
- [x] Verification runs persist.
- [x] Dashboard metrics come from real stored data.
- [x] Charts handle empty and populated datasets correctly.

### Engineering quality

- [x] Frontend and backend run using documented commands.
- [x] Environment variables are documented in `.env.example`.
- [x] No real secrets are committed. (`.env` is gitignored; nothing committed yet.)
- [x] Type checking and linting pass.
- [x] Core services have automated tests.
- [x] The end-to-end debugging workflow is covered by an integration or browser test.

---

## 19. Demonstration Scenario

Use a small, deliberately broken login application as the primary demonstration project.

The repository should contain a reproducible bug and a test that fails before the fix.

Demonstration sequence:

1. Open the broken application in Bytewise.
2. Submit a debugging request describing the login failure.
3. Show the actual source evidence retrieved by the context engine.
4. Display the AI's suspected cause and explain why it fits the evidence.
5. Generate a minimal patch.
6. Inspect the before-and-after diff.
7. Reject or approve the patch to demonstrate user control.
8. Apply the approved patch.
9. Execute the configured test.
10. Show the real exit status and test output.
11. Display the verification outcome in the session and dashboard.
12. Explain how the original evidence led to the fix.

The demo must use a reproducible bug and real test execution. If a step fails, the application should show the real failure rather than substitute fabricated results.

---

## 19A. Direction change (2026-11-04): Bytewise as a VS Code extension

The web MVP (Phases 1–7) is complete. The product now focuses on a **VS Code extension**:
a Meta-powered coding agent in the editor's sidebar, comparable in shape to Claude Code's
extension. The web app remains in the repository as a reference implementation; the
extension reuses its tested logic (Meta provider, evidence search, path policy, patch
validation, command policy, process runner, voice).

Verified 2026-11-04: `muse-spark-1.3` supports OpenAI-style tool calling in a multi-turn
loop (it chose `read_file` on its own and used the returned content).

Principles carried over unchanged: the agent **asks before every file edit and every
command**; edits are shown in VS Code's diff view with Accept / Reject and are undoable;
only allowed project scripts run; results are never fabricated; the API key lives in VS
Code SecretStorage and never reaches the webview.

Extension phases:

- [x] **E1 — Skeleton:** activity-bar panel, chat with `muse-spark-1.3`, key stored in SecretStorage.
- [x] **E2 — Agent that reads:** tool loop with read-only tools (list, read, search) on the open folder.
- [x] **E3 — Agent that edits:** proposed edits in the native diff view; Accept / Reject; undo.
- [x] **E4 — Agent that verifies:** runs allowed test scripts after approval; reads failures; retries.
- [x] **E5 — Polish & package:** voice input (Muse Voice Transcribe WebSocket + WAV parser + audio command + webview dictation), `@file` mentions (inline suggestions + line ranges), conversation history (session titles, QuickPick session switcher, persistence across restarts), and `.vsix` packaging (`dist/bytewise.vsix`).

## 20. Scope Boundaries and Future Enhancements

Do not build these features before the MVP workflow is reliable:

- A full VS Code extension. *(Superseded by Section 19A: the extension is now the focus.)*
- Autonomous multi-agent orchestration.
- Unrestricted autonomous shell access.
- A complex vector database or semantic indexing platform.
- Broad support for every programming language.
- Production-grade enterprise organization management.
- Large-scale analytics.
- Automatic deployment to production.
- Unreviewed background code modifications.

Possible future enhancements include:

- IDE integrations.
- Git branch and pull-request workflows.
- Deeper semantic code indexing.
- Additional language support.
- Team collaboration.
- Reusable project-specific debugging memory.
- More advanced test selection.
- Optional isolated background verification.

These should be introduced only after the core evidence-to-fix workflow is dependable.

---

## 21. Instructions to the Coding Agent

Treat this document as the product and architecture brief.

Before implementing:

1. Inspect the existing repository and preserve any useful working code.
2. Identify any existing conventions, dependencies, and scripts.
3. Confirm the official Meta model, SDK, authentication, and hackathon constraints from authoritative documentation.
4. Document any necessary deviations from the recommended stack.
5. Establish shared schemas and a working frontend-to-backend connection.

While implementing:

- Build complete, functional vertical slices rather than a collection of disconnected screens.
- Use TypeScript throughout the frontend, backend, and shared contracts.
- Keep the backend in TypeScript.
- Use the recommended Next.js, React, Tailwind CSS, Fastify, SQLite, and Drizzle stack unless the existing project requires a justified adjustment.
- Keep AI-provider code isolated behind an adapter.
- Make the main user workflow the highest priority.
- Use real backend data for project information, verification results, and charts.
- Never fabricate model results, source evidence, or successful tests.
- Keep code changes behind explicit approval.
- Implement security checks in the backend, not just the UI.
- Add automated tests for important behavior.
- Avoid unnecessary abstractions and dependencies.
- Do not implement every proposed module before the core workflow requires it.

At the end of each phase, report:

- What was implemented.
- Which files or modules were added or changed.
- How to run the application.
- Which checks and tests were executed.
- What passed and what failed.
- Any remaining limitations or blockers.

If a required integration cannot be completed because credentials, SDK access, or environmental capabilities are missing, implement a clearly isolated interface and report the limitation. Do not pretend the integration is operational.

## 22. Definition of Success

Bytewise succeeds as an MVP when a developer can provide a real debugging request, see relevant evidence from a supported project, receive a plausible and evidence-grounded diagnosis, review and explicitly approve a code patch, apply that patch safely, and inspect the result of a real test run.

The central product differentiator is the **Evidence-to-Fix Loop**:

**Source Evidence → AI Diagnosis → Minimal Patch → Human Approval → Real Verification**

Every major architectural and UI decision should support that loop.

Build this workflow first, make it trustworthy, and then improve the surrounding experience.
