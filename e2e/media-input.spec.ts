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

test("dictation streams words into the box while speaking, keeping typed text", async ({
  page,
}) => {
  await openProject(page);
  const input = page.getByLabel("Message");
  await input.fill("Context:");

  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop dictation" });
  await expect(stop).toBeVisible();
  // Words appear while the microphone is still on, after what was typed.
  await expect(input).toHaveValue(/^Context: \S+/, { timeout: 20_000 });
  await expect(stop).toBeVisible();
  await expect(input).toHaveValue(/login endpoint/i, { timeout: 20_000 });

  await stop.click();
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(input).toHaveValue(/^Context: .*login endpoint/i);
  // Nothing was sent: the transcript waits for the developer to review it.
  await expect(page.getByText("AI hypothesis")).toHaveCount(0);
});

test("Esc cancels dictation and restores what was typed", async ({ page }) => {
  await openProject(page);
  const input = page.getByLabel("Message");
  await input.fill("Typed first");
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await expect(input).toHaveValue(/^Typed first \S+/, { timeout: 20_000 });
  await input.press("Escape");
  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible();
  await expect(input).toHaveValue("Typed first");
});

test("an attached image reaches the model with the message", async ({ page }) => {
  await openProject(page);
  await page
    .locator('input[type="file"][accept*="image/png"]')
    .first()
    .setInputFiles(path.join(FIXTURES, "login-error.png"));
  await expect(page.getByRole("img", { name: "login-error.png" })).toBeVisible();

  const input = page.getByLabel("Message");
  await input.fill("Describe the error message shown in this screenshot.");
  await input.press("Enter");

  // The stored message shows the image, served back by the API.
  const sent = page.getByRole("link", { name: "login-error.png" });
  await expect(sent).toBeVisible({ timeout: 120_000 });
  expect(
    await sent.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  // The tray is cleared once the message is sent.
  await expect(page.getByRole("button", { name: "Remove login-error.png" })).toHaveCount(0);
});

test("sending while dictating stops the microphone", async ({ page }) => {
  await openProject(page);
  const input = page.getByLabel("Message");
  await page.getByRole("button", { name: "Dictate", exact: true }).click();
  await expect(input).toHaveValue(/login endpoint/i, { timeout: 20_000 });
  const spoken = await input.inputValue();
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop dictation" })).toHaveCount(0);
  // The spoken words were sent; late transcript text does not refill the box.
  await expect(page.getByText(spoken.trim(), { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(input).toHaveValue("");
});

test("highlights screenshot regions with SAM and records them as evidence", async ({ page }) => {
  await openSession(page);

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByLabel("Screenshot file").setInputFiles(path.join(FIXTURES, "login-error.png"));
  await page.getByRole("button", { name: "Find regions with SAM 3.1" }).click();

  const shots = page.getByRole("region", { name: "Screenshots" });
  await expect(shots.getByText(/region\(s\) matching "text box"/)).toBeVisible({ timeout: 60_000 });
  await expect(shots.getByRole("img", { name: /highlighted region/ })).toBeVisible();
  await expect(page.getByText(/SAM 3\.1 found \d+ region\(s\) matching "text box"/)).toBeVisible();
});
