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

  // 2. Start a debugging session.
  await page.getByRole("button", { name: "New debugging session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);

  // 3. Baseline: the real test suite fails before any change.
  await page.getByRole("tab", { name: "Tests" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  const result = page.getByRole("region", { name: "Verification result" });
  await expect(result.getByText("Failed", { exact: true })).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(result.getByText("Baseline (no patch)")).toBeVisible();

  // 4. Describe the bug; the model returns an evidence-grounded hypothesis.
  await page
    .getByLabel("Message")
    .fill("The login endpoint returns a 500 error when a user submits valid credentials.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("AI hypothesis · not verified")).toBeVisible({
    timeout: MODEL_TIMEOUT,
  });
  await expect(page.getByText("Supporting evidence")).toBeVisible();

  // 5. Propose a patch, review it, and explicitly approve it.
  await page.getByRole("tab", { name: "Patch" }).click();
  await page.getByRole("button", { name: "Propose a fix" }).click();
  await expect(page.getByRole("button", { name: "Apply patch" })).toBeVisible({
    timeout: MODEL_TIMEOUT,
  });
  await expect(page.getByText("src/services/session.js").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply patch" }).click();
  await page.getByRole("button", { name: "Confirm and apply" }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();

  // 6. Verify: the same real test suite now passes with the patch applied.
  await page.getByRole("tab", { name: "Tests" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await expect(result.getByText("Passed", { exact: true })).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(result.getByText("With patch applied")).toBeVisible();
  await expect(result.getByText(/fail 0/)).toBeVisible();
  await expect(page.locator("header").getByText("Fix verified")).toBeVisible();

  // 7. The dashboard reflects the stored outcome.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page.getByRole("group", { name: "Verified fixes" }).getByText("1", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Verification outcomes")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Verification runs per day by outcome" }),
  ).toBeVisible();
});
