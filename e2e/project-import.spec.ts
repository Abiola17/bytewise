import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("imports a project folder from the computer and runs its tests", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("Project folder").setInputFiles(path.join(FIXTURES, "sample-project"));

  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText("3 files")).toBeVisible();
  await expect(preview.getByLabel("Project name")).toHaveValue("sample-project");
  await preview.getByRole("button", { name: "Import project" }).click();

  // Lands on the new project's page with its files.
  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  const files = page.getByRole("navigation", { name: "Project files" });
  await expect(files.getByText("math.js")).toBeVisible();

  // The imported project's own test script runs for real.
  await page.getByRole("button", { name: "Toggle terminal" }).click();
  await page.getByRole("button", { name: "Run test", exact: true }).click();
  const result = page.getByRole("region", { name: "Verification result" });
  await expect(result.getByText("Passed", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("imports a .zip and leaves dependencies out", async ({ page }) => {
  await page.goto("/projects");
  await page
    .getByLabel("Project zip file")
    .setInputFiles(path.join(FIXTURES, "sample-project.zip"));

  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText("3 files")).toBeVisible();
  await expect(
    preview.getByText(/1 dependency, build or version-control file left out/),
  ).toBeVisible();
  await preview.getByLabel("Project name").fill("sample-from-zip");
  await preview.getByRole("button", { name: "Import project" }).click();

  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "sample-project" })).toBeVisible();
  const files = page.getByRole("navigation", { name: "Project files" });
  await expect(files.getByText("math.js")).toBeVisible();
  await expect(files.getByText("node_modules")).toHaveCount(0);
});

test("refuses to import over an existing project name", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("Project folder").setInputFiles(path.join(FIXTURES, "sample-project"));
  const preview = page.getByRole("region", { name: "Import preview" });
  await preview.getByLabel("Project name").fill("broken-login-app");
  await preview.getByRole("button", { name: "Import project" }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
});

test("imports a static site without package.json", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("Project folder").setInputFiles(path.join(FIXTURES, "static-site"));
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText("2 files")).toBeVisible();
  await expect(preview.getByText(/No package.json found/)).toBeVisible();
  await preview.getByRole("button", { name: "Import project" }).click();

  await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "static-site" })).toBeVisible();
  await expect(page.getByText("javascript", { exact: true })).toBeVisible();
});

test("offers a subfolder with package.json as the project root", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("Project folder").setInputFiles(path.join(FIXTURES, "nested-app"));
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText("4 files")).toBeVisible();
  await preview.getByRole("button", { name: "Use frontend/ as the project root" }).click();

  await expect(preview.getByText("3 files")).toBeVisible();
  await expect(preview.getByLabel("Project name")).toHaveValue("frontend");
  await expect(preview.getByText(/No package.json/)).toHaveCount(0);
});
