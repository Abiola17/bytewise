import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Voice and screenshot input against the real Meta models (no mocks). Chromium's
// fake capture device plays a recorded bug report into the real microphone path.
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${path.join(FIXTURES, "bug-report.wav")}`,
    ],
  },
});

async function openProject(page: Page) {
  await page.goto("/projects");
  const register = page.locator("li", { hasText: "broken-login-app" }).getByRole("button", {
    name: "Register",
  });
  if (await register.isVisible().catch(() => false)) await register.click();
  await page.getByRole("link", { name: /broken-login-app/ }).click();
  await expect(page.getByLabel("Message")).toBeVisible();
}

/** Screenshots belong to a chat; running the test script starts one without the model. */
async function openSession(page: Page) {
  await openProject(page);
  await page.getByRole("button", { name: "Toggle terminal" }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
}

test("dictates a bug report into the message box without sending it", async ({ page }) => {
  await openProject(page);

  await page.getByRole("button", { name: "Dictate with voice" }).click();
  await expect(page.getByRole("button", { name: /Stop recording/ })).toBeVisible();
  await page.waitForTimeout(6000); // the fixture is ~5 s of speech
  await page.getByRole("button", { name: /Stop recording/ }).click();

  const input = page.getByLabel("Message");
  await expect(input).toHaveValue(/login endpoint/i, { timeout: 60_000 });
  await expect(input).toHaveValue(/500/);
  // Nothing was sent: the transcript waits for the developer to review it.
  await expect(page.getByText("AI hypothesis")).toHaveCount(0);
});

test("highlights screenshot regions with SAM and records them as evidence", async ({ page }) => {
  await openSession(page);

  await page.getByRole("button", { name: "Add a screenshot" }).click();
  await page.getByLabel("Screenshot file").setInputFiles(path.join(FIXTURES, "login-error.png"));
  await page.getByRole("button", { name: "Find regions with SAM 3.1" }).click();

  const shots = page.getByRole("region", { name: "Screenshots" });
  await expect(shots.getByText(/region\(s\) matching "text box"/)).toBeVisible({ timeout: 60_000 });
  await expect(shots.getByRole("img", { name: /highlighted region/ })).toBeVisible();
  await expect(page.getByText(/SAM 3\.1 found \d+ region\(s\) matching "text box"/)).toBeVisible();
});
