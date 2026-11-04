# Bytewise user guide

Bytewise helps you fix a bug in a code project. You describe the problem, Bytewise
finds the relevant code, an AI model suggests the likely cause and a small fix,
**you** decide whether to apply it, and Bytewise runs the project's real tests to
show whether it worked.

```
Describe the bug → Bytewise finds evidence → AI diagnosis → proposed fix → you approve → real test run
```

Nothing changes in your project until you click **Apply patch** and confirm.

---

## 1. Start the app

From the `bytewise` folder:

```bash
pnpm dev
```

Then open **http://localhost:3000**. On the Dashboard, the **System status** card
should show _API server: Online_, _Database: Connected_ and _API key set_. If it says
_Server unreachable_ or _API key missing_, see [Troubleshooting](#8-troubleshooting).

---

## 2. The screens at a glance

| Screen           | Where                   | What it is for                                   |
| ---------------- | ----------------------- | ------------------------------------------------ |
| **Dashboard**    | sidebar → Dashboard     | Totals, a chart of test results, recent activity |
| **Projects**     | sidebar → Projects      | Register a project and open it                   |
| **Project page** | click a project         | Browse its files and search them (read-only)     |
| **Session page** | _New debugging session_ | Where you actually fix a bug                     |
| **Sessions**     | sidebar → Sessions      | Go back to earlier debugging sessions            |

---

## 3. Walkthrough: fix the demo login bug

The repository includes a small demo app, **broken-login-app**, whose login returns
an error (HTTP 500) even with the right password. This walkthrough fixes it.

### Step 1 — Register the project

1. Click **Projects** in the sidebar.
2. Under _Available in the projects directory_, click **Register** next to
   `broken-login-app`.
3. Click the project name to open it.

You can register a project only once. **If `broken-login-app` is already in the list
and there is no Register button, it is already registered** — just click it to open it.

### Step 2 — Look around (optional)

The project page has three parts:

- **File tree** (left): the project's files. Secrets (`.env`, keys), dependencies
  and build folders are hidden on purpose.
- **Code viewer** (middle): click a file to read it. You cannot edit here.
- **Evidence panel** (right): type a bug description and click **Gather evidence**
  to see which code Bytewise considers relevant. This step does not use AI.

### Step 3 — Start a debugging session

Click **New debugging session** (top right of the project page). You land on the
session page:

- **Left: chat.** You describe the problem here.
- **Right: four tabs.** **Diagnosis**, **Patch**, **Tests**, **Evidence**.
- **Top: status badge.** Shows where the session is (see [Statuses](#6-what-the-labels-mean)).

### Step 4 — Run the tests first (recommended)

1. Open the **Tests** tab.
2. Click **Run** next to `npm run test`.
3. After a moment the result shows **Failed** — the bug is real. You can read the
   actual test output below the result.

This is the "before" picture. Its output also helps the AI: it is added as evidence.

### Step 5 — Describe the bug

In the chat box, type for example:

> The login endpoint returns a 500 error when a user submits valid credentials.

Then click the send button (or press **⌘/Ctrl + Enter**).

**Prefer speaking?** Click the **microphone** button, talk, then click it again
(it shows the seconds while recording). Your words appear in the chat box so you
can correct them. **They are not sent until you click send.**

Wait 10–30 seconds while Bytewise gathers evidence and asks the model.

### Step 6 — Read the diagnosis

The **Diagnosis** tab shows:

- **Summary** and **Likely cause**: what the AI thinks is wrong, naming the file
  and line.
- **Suggested fix**: the change it recommends, in words.
- **Supporting evidence**: click an item to see the exact code it is based on.
- **Uncertainty** and **Limitations**: what it is not sure about.

It is labelled **AI hypothesis · not verified**: it is an informed guess, not a
proven fact. If the AI does not have enough information, it asks you questions
instead — answer them in the chat.

### Step 7 — Review the proposed fix

1. Click **Review a proposed fix** (or open the **Patch** tab).
2. Click **Propose a fix**. After a few seconds you see:
   - which files would change, with `+` added / `−` removed line counts,
   - a short explanation,
   - a **before/after view** of the code (removed lines in red, added in green).
3. Proposing a fix **does not change any file**.

Then choose:

- **Apply patch** → **Confirm and apply**: writes the change to the project.
- **Reject patch**: discards it. No files change.

If the file was edited after the fix was proposed, Bytewise refuses to apply it and
says so. Click **Propose a new fix** to get one based on the current code.

### Step 8 — Verify the fix

1. Open the **Tests** tab and click **Run** again.
2. The result should now show **Passed**, marked _With patch applied_.
3. The session badge at the top changes to **Fix verified**.

**Passed** only ever means the test command really finished successfully. If it
fails, click **Diagnose this failure**: Bytewise sends the failing output back to the
AI and you continue from Step 6.

### Step 9 — Undo it (to run the demo again)

Open the **Patch** tab and click **Revert patch**. The original code — with the
bug — is restored, so you can repeat the demo. (From a terminal,
`git checkout examples/broken-login-app` does the same.)

---

## 4. Adding a screenshot (optional)

If the bug is visible on screen, you can attach a screenshot:

1. Open the **Evidence** tab in a session.
2. Under **Add a screenshot of the bug**, choose a PNG, JPEG or WebP file (up to 4 MB).
3. Type what to highlight as a **concrete noun**, e.g. `button` or `text box`.
   Abstract words such as "warning" usually find nothing.
4. Click **Find regions with SAM 3.1**. The matching areas are outlined and numbered,
   and the result is added to the evidence for the next diagnosis.

---

## 5. Using your own project

1. Go to **Projects**. At the top, under **Import a project**, click **Choose folder**
   (pick your project's top folder) or **Choose .zip**.
2. Check the preview: how many files will be imported and what is left out.
   Dependencies (`node_modules`), build output, secrets such as `.env`, binary files and
   files over 1 MB are never imported.
3. Adjust the **Project name** if you like, then click **Import project**. You are taken
   straight to the new project.

Bytewise copies the files in as a new project — your originals are not changed. A
`package.json` is **optional**: without one (for example a plain HTML/CSS/JS site) you can
still describe bugs, get diagnoses and apply fixes; only the **Tests** tab has nothing to
run. If your `package.json` is in a subfolder (e.g. `frontend/`), the preview offers a
**Use frontend/ as the project root** button. To use the Tests tab the project needs a
script named `test` (or `test:…`, `typecheck`, `lint`, `check`); tests that need
installed packages may not run until those are installed in the project folder.
Limits: 2,000 files and 25 MB.

Bytewise works best on small JavaScript or TypeScript projects.

---

## 6. What the labels mean

**Kinds of information** — Bytewise keeps these separate on purpose:

| Label                            | Meaning                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| **Observed evidence**            | Copied directly from your files, test output or screenshot. Real. |
| **AI hypothesis · not verified** | The model's explanation. May be wrong.                            |
| **Passed / Failed** (Tests tab)  | What actually happened when the command ran. Real.                |

**Session status** (badge at the top of a session):

| Status              | Meaning                            |
| ------------------- | ---------------------------------- |
| Open                | Started, no diagnosis yet          |
| Diagnosed           | The AI has proposed a likely cause |
| Needs information   | The AI asked you questions         |
| Patch proposed      | A fix is waiting for your decision |
| Patch applied       | You applied a fix; not yet tested  |
| **Fix verified**    | Tests passed with the fix applied  |
| Verification failed | Tests failed with the fix applied  |

**Test run results** (Tests tab):

| Result        | Meaning                                       |
| ------------- | --------------------------------------------- |
| Running       | Still in progress                             |
| **Passed**    | The command finished successfully             |
| **Failed**    | The command finished and reported failures    |
| Timed out     | It took longer than 2 minutes and was stopped |
| Blocked       | That command is not allowed, so nothing ran   |
| Could not run | It could not start or was interrupted         |

---

## 7. What Bytewise will never do

- Change a file without your **Apply patch → Confirm and apply**.
- Edit your tests, `package.json` or lockfiles as part of a fix.
- Run a command the AI suggests. Only your project's own `test`, `lint`,
  `typecheck` or `check` scripts can run.
- Show you a passing result that did not really happen.
- Send your API keys to the browser or to your project's code.

---

## 8. Troubleshooting

| You see                                    | What to do                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| _Server unreachable_                       | Run `pnpm dev` in the `bytewise` folder.                                             |
| _API key missing_                          | Add `META_API_KEY=` to the `.env` file, then restart `pnpm dev`.                     |
| _The Meta API rejected the API key_        | The key in `.env` is wrong or expired.                                               |
| Page shows an error after an update        | Stop `pnpm dev` (Ctrl+C) and start it again.                                         |
| _The model could not propose a safe patch_ | The AI needs more context: add detail in the chat, then try **Propose a fix** again. |
| _…changed after the patch was proposed_    | Click **Propose a new fix**.                                                         |
| _Microphone access was denied_             | Allow the microphone for `localhost` in your browser settings.                       |
| _No regions matched_ (screenshot)          | Use a more concrete noun, e.g. `button`.                                             |
| The demo test already passes               | The fix is still applied: use **Revert patch** (Step 9).                             |
