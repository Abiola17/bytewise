import { expect, test } from "@playwright/test";

// Drives the complete Evidence-to-Fix Loop through the browser against the real
// server and the real configured model (no mocks). Requires META_API_KEY in .env.
const MODEL_TIMEOUT = 180_000;
const RUN_TIMEOUT = 60_000;

test("diagnose, patch, approve and verify the demo login bug", async ({ page }) => {
  // 1. Register and open the demo project.
  await page.goto("/projects");
  const available = page.locator("li", { hasText: "broken-login-app" });
  await available.getByRole("button", { name: "Register" }).click();
  await page.getByRole("link", { name: /broken-login-app/ }).click();
  await expect(page.getByRole("navigation", { name: "Project files" })).toBeVisible();

  // 2. Baseline: the real test suite fails before any change. Running a script
  //    from the terminal starts the chat.
  await page.getByRole("button", { name: "Toggle terminal" }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  const result = page.getByRole("region", { name: "Verification result" });
  await expect(result.getByText("Failed", { exact: true })).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(result.getByText("Baseline (no patch)")).toBeVisible();

  // 3. Describe the bug; the model returns an evidence-grounded hypothesis.
  await page
    .getByLabel("Message")
    .fill("The login endpoint returns a 500 error when a user submits valid credentials.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("AI hypothesis · not verified")).toBeVisible({
    timeout: MODEL_TIMEOUT,
  });
  await expect(page.getByText("Supporting evidence")).toBeVisible();

  // 4. Propose a patch, review it in the chat, and explicitly accept it.
  await page.getByRole("button", { name: "Propose a fix" }).click();
  const change = page.getByRole("region", { name: "Proposed change" });
  await expect(change.getByRole("button", { name: "Accept and apply" })).toBeVisible({
    timeout: MODEL_TIMEOUT,
  });
  await expect(change.getByText("src/services/session.js")).toBeVisible();
  // The diff opens in the editor before anything is written.
  await expect(page.getByRole("tab", { name: /session\.js.*proposed/ })).toBeVisible();
  await change.getByRole("button", { name: "Accept and apply" }).click();
  await expect(change.getByText("Applied", { exact: true })).toBeVisible();

  // 5. Verify: the same real test suite now passes with the patch applied.
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  await expect(result.getByText("Passed", { exact: true })).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(result.getByText("With patch applied")).toBeVisible();
  await expect(result.getByText(/fail 0/)).toBeVisible();
  await expect(page.locator("header").getByText("Fix verified")).toBeVisible();

  // 6. The dashboard reflects the stored outcome.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page.getByRole("group", { name: "Verified fixes" }).getByText("1", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Verification outcomes")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Verification runs per day by outcome" }),
  ).toBeVisible();
});
