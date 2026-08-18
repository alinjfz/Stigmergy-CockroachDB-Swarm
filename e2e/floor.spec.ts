import { expect, test } from "@playwright/test";

test("floor HUD renders spawn controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stigmergy" })).toBeVisible();
  await expect(page.getByText("SERIALIZABLE · memory = CockroachDB")).toBeVisible();
  await expect(page.getByRole("button", { name: "Spawn 8" })).toBeVisible();
  await page.getByRole("button", { name: "Spawn 8" }).click();
  await expect(page.locator("aside").getByText(/Committed rows/)).toBeVisible();
});
