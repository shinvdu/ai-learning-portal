/**
 * Smoke suite for the v2 portal (ports the verified manual QA flows).
 *
 * Every test is independent: each gets a fresh browser context, navigates
 * directly to the route it needs and re-authenticates when required. The
 * `consoleGuard` auto-fixture fails a test if the page logs a console error or
 * throws an uncaught exception (with a tiny allowlist for dev-only noise).
 *
 * Golden numbers asserted here come from the packaged seed fixture:
 * 24 students / 5 courses / 58 enrollments / 74.3% completion / 86.4 avg score,
 * C3 = 17 learners and 55.9% completion.
 */
import { test as base, expect } from '@playwright/test';
import { E2E } from './env';

const IGNORED_CONSOLE = [/favicon/i, /Download the Vue Devtools/i];

function isIgnoredConsole(text: string): boolean {
  return IGNORED_CONSOLE.some((pattern) => pattern.test(text));
}

/** Auto-fixture: collect console errors + uncaught exceptions and assert none. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (isIgnoredConsole(text)) return;
        problems.push(text);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

      await use();

      expect(
        problems,
        `unexpected browser console errors:\n${problems.join('\n')}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

test.describe('public UI', () => {
  test('home shows five course cards and live KPIs', async ({ page }) => {
    await page.goto('/');

    const cards = page.locator('.course-card');
    await expect(cards).toHaveCount(5);

    const stats = page.locator('.hero-stat strong');
    await expect(stats.nth(0)).toHaveText('24'); // students
    await expect(stats.nth(1)).toHaveText('5'); // courses
    await expect(stats.nth(2)).toHaveText('58'); // enrollments
    await expect(stats.nth(3)).toHaveText('74.3%'); // avg completion
    await expect(stats.nth(4)).toHaveText('86.4'); // avg quiz score
    await expect(stats.nth(5)).toContainText('165.3'); // total hours

    await expect(page.getByRole('heading', { level: 1 })).toContainText('AI 学习与');
  });

  test('course C3 shows Python 数据分析 with 17 learners and 55.9% completion', async ({
    page,
  }) => {
    await page.goto('/courses/C3');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Python 数据分析');
    const miniStats = page.locator('.stat-row .mini-stat');
    await expect(miniStats.nth(0).locator('strong')).toHaveText('17');
    await expect(miniStats.nth(2).locator('strong')).toHaveText('55.9%');
    await expect(page.locator('.big-progress .big-value')).toHaveText('55.9%');
  });

  test('dashboard computes 74.3 / 86.4 and renders six charts', async ({ page }) => {
    await page.goto('/dashboard');

    const kpiGrid = page.locator('.kpi-grid');
    await expect(kpiGrid.locator('.kpi-card')).toHaveCount(5);
    await expect(kpiGrid).toContainText('74.3%');
    await expect(kpiGrid).toContainText('86.4分');

    await expect(page.locator('.chart-card')).toHaveCount(6);
    await expect(page.locator('.chart-canvas')).toHaveCount(6);

    // Desktop chart height is 280px (compact is 230px).
    const box = await page.locator('.chart-canvas').first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(250);
  });

  test('dashboard is compact at 390px and has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');

    await expect(page.locator('.chart-card')).toHaveCount(6);

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);

    const box = await page.locator('.chart-canvas').first().boundingBox();
    const height = box?.height ?? 0;
    expect(height).toBeGreaterThan(200);
    expect(height).toBeLessThan(250);
  });

  test('knowledge quiz grades three questions', async ({ page }) => {
    await page.goto('/knowledge');

    await expect(page.locator('.knowledge-layout')).toBeVisible();
    const items = page.locator('.quiz-item');
    await expect(items).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      await items.nth(index).locator('input[type="radio"]').first().check();
    }
    await page.getByRole('button', { name: '提交答案' }).click();

    await expect(page.locator('.explain')).toHaveCount(3);
    await expect(page.locator('.quiz-score')).toContainText(/(?:得分 \d\/3|已作答 3\/3)/);
  });
});

test.describe('auth and navigation', () => {
  test('admin can log in and switch admin tabs', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input[name="email"]').fill(E2E.adminEmail);
    await page.locator('input[name="password"]').fill(E2E.adminPassword);
    await page.locator('form').getByRole('button', { name: '登录' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('用户与课程管理');

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);

    await expect(page.locator('#admin-users-title')).toBeVisible();

    await page.getByRole('tab', { name: '课程管理' }).click();
    await expect(page.locator('#admin-courses-title')).toBeVisible();

    await page.getByRole('tab', { name: '审计日志' }).click();
    await expect(page.locator('#admin-audit-title')).toBeVisible();
  });

  test('legacy hash route redirects to its history route', async ({ page }) => {
    await page.goto('/#/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('学习数据总览');
  });

  test('primary pages render without console errors', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.course-card').first()).toBeVisible();

    await page.goto('/knowledge');
    await expect(page.locator('.knowledge-layout')).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.locator('.chart-card').first()).toBeVisible();

    await page.goto('/insights');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('从学习记录里读出什么');

    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 2, name: '普通用户' })).toBeVisible();
  });
});