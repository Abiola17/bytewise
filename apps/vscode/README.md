# Bytewise — Meta-Powered Coding Assistant for VS Code

Bytewise is an AI-powered coding agent built for VS Code that helps developers investigate software bugs, understand codebases, review safe code diffs, and verify fixes with real test execution.

Powered by **Meta Muse Spark 1.3** and **Meta Muse Voice Transcribe**.

---

## The Evidence-to-Fix Workflow

Bytewise is not a chatbot that simply gives advice. It follows a structured, evidence-grounded workflow:

1. **Investigation & Evidence**: The agent reads relevant files, searches codebases, and checks line ranges without modifying anything.
2. **Diagnosis**: Explains the root cause grounded in actual project evidence.
3. **Proposed Fixes**: Generates minimal, focused edits displayed directly in VS Code's native diff viewer.
4. **Human Review & Approval**: You have complete control. Accept or reject each change before any file on disk is touched.
5. **Real Verification**: Runs permitted project test scripts (e.g. `npm test`, `pnpm run typecheck`), captures genuine process output and exit codes, and diagnoses test failures if needed.

---

## Features

- **Activity Bar & Status Bar**: Quick access to the Bytewise chat panel from the activity bar icon or the status bar item.
- **Natural Conversation**: Driven by `muse-spark-1.3` with autonomous tool calling (inspecting files, searching code, listing directories).
- **Interactive Diff Review**: Review proposed changes side-by-side using VS Code's native diff editor with **Accept** and **Reject** actions.
- **Undo Safe Edits**: Accepted edits can be cleanly undone or re-reviewed.
- **Controlled Test Execution**: Runs project test and verification scripts with timeouts, isolated environments, and output truncation.
- **`@file` Mentions**: Type `@` in the chat box to quickly autocomplete and attach specific workspace files and line ranges (e.g., `@src/login.js:10-25`).
- **Selection Context**: Right-click any code selection and choose **"Ask Bytewise About Selection"** to immediately bring that snippet into conversation.
- **Voice Input**: Dictate bug reports directly into the message box with Meta Muse Voice Transcribe.
- **Session History**: Persists conversations across workspace restarts, with the ability to switch between previous sessions or start fresh.
- **Secure by Design**: Your Meta API key is stored in VS Code's encrypted `SecretStorage` and never exposed to the webview or external processes.

---

## Quick Start

1. Install the Bytewise extension (`.vsix`).
2. Open a project folder in VS Code (`File → Open Folder`).
3. Click the **Bytewise** icon in the Activity Bar or Status Bar.
4. Set your Meta API key by clicking **Set Meta API key** or running `Bytewise: Set Meta API Key` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
5. Ask Bytewise to investigate a bug or explain code!

---

## Commands

- `Bytewise: Open Chat` — Opens the sidebar chat panel.
- `Bytewise: New Chat` — Starts a new debugging session.
- `Bytewise: Conversation History` — Browse and switch between recent debugging sessions.
- `Bytewise: Set Meta API Key` — Securely saves your Meta API key in VS Code SecretStorage.
- `Bytewise: Remove Meta API Key` — Removes your stored Meta API key.
- `Bytewise: Transcribe Audio File` — Transcribe a spoken bug report (`.wav` or `.pcm`) with Muse Voice Transcribe.
- `Bytewise: Ask Bytewise About Selection` — Mentions the highlighted lines in the chat input.

---

## Configuration Settings

- `bytewise.model`: The Meta model identifier (default: `muse-spark-1.3`).
- `bytewise.baseUrl`: The Meta Model API base URL (default: `https://api.meta.ai/v1`).
- `bytewise.requestTimeoutSeconds`: Request timeout for model calls in seconds (default: `120`).
- `bytewise.commandTimeoutSeconds`: Time limit for test verification scripts in seconds (default: `120`).

---

## Privacy and Security

- **Strict Sandbox**: Only workspace files within the active folder are accessible. Prohibited files (such as `.env`, credentials, `.git`) are strictly excluded.
- **No Autonomous File Changes**: Bytewise never modifies files without your explicit approval via the diff viewer.
- **Zero Command Hallucination**: Only existing `test`, `typecheck`, and `lint` scripts in your `package.json` can be executed. Arbitrary shell commands are blocked.
- **Encrypted Credentials**: Your Meta API key never leaves the extension host process and is stored in OS keychain-backed SecretStorage.
