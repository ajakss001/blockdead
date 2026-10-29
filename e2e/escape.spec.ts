import { expect, type Page, test } from '@playwright/test';
import { ORIGIN, serveGame } from './serve';

/**
 * Escape in game windows. Under pointer lock Chrome does not give Escape to the page, it only drops the
 * lock: the game must read that as "close the window / stop searching", show the quiet "click to
 * continue" and never the pause screen. With the cursor already free, the Escape keydown closes it.
 */

type W = Window & { __game: { ctx: { events: { emit(e: string, p: unknown): void }; loop: { reasons: Set<string> } }; scene: Record<string, any> } };

async function start(page: Page): Promise<void> {
  // Pointer lock in a headless browser: emulate what Chrome does (lock on request, Esc only drops it).
  await page.addInitScript(() => {
    let locked: Element | null = null;
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
    Element.prototype.requestPointerLock = function (this: Element) {
      locked = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    } as typeof Element.prototype.requestPointerLock;
    Document.prototype.exitPointerLock = function () {
      if (!locked) return;
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    // The browser's own Esc under lock: drops the lock, the page sees no keydown.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape' && locked) {
          e.stopImmediatePropagation();
          e.preventDefault();
          document.exitPointerLock();
        }
      },
      true,
    );
  });
  await serveGame(page);
  await page.goto(`${ORIGIN}/?editor=0&seed=1&zombies=0`);
  await page.waitForFunction(() => !!(window as unknown as W).__game?.scene?.panel, null, { timeout: 60_000 });
  // Into the game: click → pointer lock.
  await page.locator('.play-overlay').click();
  await expect(page.locator('.play-overlay')).toBeHidden();
}

const pauseShown = (page: Page) => page.evaluate(() => !(document.querySelector('.play-overlay') as HTMLElement).hidden || (window as unknown as W).__game.ctx.loop.reasons.has('menu'));

test('container window: Escape closes it, no pause screen', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const sc = (window as unknown as W).__game.scene;
    const ref = [...sc.containers.byChunk.values()].flat()[0];
    sc.panel.open(ref);
  });
  await expect(page.locator('.inv')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv')).toBeHidden();
  expect(await pauseShown(page)).toBe(false);
  // Back in the game: the mouse picked up again, or (when the browser refuses after Esc) the quiet hint.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => !!document.pointerLockElement || !(document.querySelector('.soft-hint') as HTMLElement).hidden)).toBe(true);
  expect(await pauseShown(page)).toBe(false);
});

test('search in progress (mouse captured): Escape stops it quietly, no pause screen', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const g = (window as unknown as W).__game;
    const sc = g.scene;
    const ref = [...sc.containers.byChunk.values()].flat()[0];
    sc.interaction.searchRef = ref;
    sc.interaction.searchTime = 30;
    sc.interaction.searchT = 0;
    g.ctx.events.emit('ui:busy', { busy: true });
  });
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as W).__game.scene.interaction.searchT)).toBeLessThan(0);
  expect(await pauseShown(page)).toBe(false);
  await expect(page.locator('.soft-hint')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.inv')).toBeHidden();
  expect(await pauseShown(page)).toBe(false);
});

test('inventory (Tab), then Escape with the cursor free: closes, no pause screen', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.inv')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv')).toBeHidden();
  expect(await pauseShown(page)).toBe(false);
});

test('Escape while just playing: the pause screen (unchanged)', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.play-overlay')).toBeVisible();
});
