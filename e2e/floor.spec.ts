import { expect, test } from "@playwright/test";

/**
 * These tests assert the things the interface has to say for itself, because the
 * product is judged without a narrator. They check comprehension, not layout.
 */

test.beforeEach(async ({ request }) => {
  await request.post("/api/control", { data: { action: "reset" } });
});

test("a first-time visitor is told what this is and what to do", async ({ page }) => {
  await page.goto("/");

  // The claim, not the product name, is the first thing read.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/never talk to each other/i);

  // The absence of messaging is a number on screen, not an assertion in prose.
  await expect(page.getByText("Messages between pickers")).toBeVisible();

  // Nothing is moving, and the reason is stated rather than left to inference.
  await expect(page.getByRole("status").filter({ hasText: /Nothing is running yet/i })).toBeVisible();
  await expect(page.getByText(/Nothing moves until you start the pickers/i)).toBeVisible();

  await expect(page.getByRole("button", { name: /Start 8 pickers/i })).toBeEnabled();
});

test("staging a conflict produces evidence naming the winner and the loser", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Cause a conflict/i }).click();

  const card = page.getByRole("heading", { name: /Two pickers wanted the same/i }).first();
  await expect(card).toBeVisible({ timeout: 15000 });

  const evidence = page.getByRole("region", { name: "Evidence" });
  await expect(evidence).toContainText(/won it/i);
  await expect(evidence).toContainText(/lost/i);
  await expect(evidence).toContainText(/sent no message/i);

  // The loss is counted, so the outcome is not only a one-off card.
  await expect(page.getByText("Claims lost to another picker")).toBeVisible();
});

test("the activity feed says which package each decision was about", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Cause a conflict/i }).click();

  const feed = page.getByRole("region", { name: "Activity" });
  await expect(feed.getByText(/Won a package/i).first()).toBeVisible({ timeout: 15000 });
  await expect(feed.getByText(/Lost a package/i).first()).toBeVisible();

  // Showing the SQL is how a technical reviewer verifies the claim themselves.
  await page.getByRole("button", { name: /Show the SQL/i }).click();
  await expect(feed.getByText(/UPDATE packages SET/i).first()).toBeVisible();
});

test("the grid is one tab stop and moves under the arrow keys", async ({ page }) => {
  await page.goto("/");

  // 120 cells must not mean 120 tab stops, or keyboard users cannot reach the
  // controls underneath the floor.
  const stops = await page.locator('[role="gridcell"][tabindex="0"]').count();
  expect(stops).toBe(1);

  await page.locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[role="gridcell"][tabindex="0"]')).toHaveAttribute("data-cell", "1,1");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /Cell 1,1/i })).toBeVisible();
});

test("the read-only view refuses a write and says why", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Cause a conflict/i }).click();
  await page.waitForTimeout(2000);

  await page.getByRole("link", { name: /Who holds what/i }).click();
  await expect(page.getByRole("heading", { name: /Who holds what/i })).toBeVisible();

  await page.getByRole("button", { name: /Release it/i }).first().click();
  await expect(page.getByRole("heading", { name: "Refused" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/no write path/i)).toBeVisible();
});
