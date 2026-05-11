import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:8080';
const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8000/api';
const areaName = `E2E Bereich ${Date.now()}`;
const scheduleLabel = 'Zeitplan anlegen';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });

async function gotoPath(path, headingText) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: headingText, exact: false }).first().waitFor({ timeout: 15000 });
}

async function cleanupAreaByName(name) {
  const response = await fetch(`${apiBaseUrl}/zones`);
  if (!response.ok) {
    return;
  }
  const areas = await response.json();
  const target = areas.find((area) => area.name === name);
  if (target) {
    await fetch(`${apiBaseUrl}/zones/${target.id}`, { method: 'DELETE' });
  }
}

try {
  const result = { areaName, steps: [] };

  await fetch(`${apiBaseUrl}/watering/stop-all`, { method: 'POST' }).catch(() => undefined);
  await fetch(`${apiBaseUrl}/system/release-safety-stop`, { method: 'POST' }).catch(() => undefined);

  await gotoPath('/areas', 'Bereiche');
  await page.getByRole('button', { name: 'Bereich anlegen' }).click();
  await page.locator('input[formcontrolname="name"]').fill(areaName);
  await page.locator('input[formcontrolname="default_manual_duration_minutes"]').fill('2');
  await page.locator('input[formcontrolname="max_duration_minutes"]').fill('2');
  await page.locator('textarea[formcontrolname="description"]').fill('E2E Bedienfluss');
  await page.getByRole('button', { name: 'Bereich anlegen' }).last().click();
  await page.getByRole('heading', { name: areaName, exact: false }).waitFor({ timeout: 15000 });
  result.steps.push('area-created');

  const areaCard = page.locator('.area-card', { has: page.getByRole('heading', { name: areaName, exact: false }) }).first();
  await areaCard.getByRole('button', { name: 'Plan ändern' }).click();
  await page.waitForURL(/\/schedules\?zoneId=\d+/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const select = document.querySelector('.schedules-filter-grid select');
    return !!select && select.value !== '';
  }, { timeout: 5000 });
  const selectedFilterLabel = await page.locator('.schedules-filter-grid select').first().evaluate((el) => {
    const select = el;
    return select.options[select.selectedIndex]?.textContent?.trim() || '';
  });
  if (selectedFilterLabel !== areaName) {
    throw new Error(`Expected schedule filter to be prefilled with ${areaName}, got ${selectedFilterLabel}`);
  }
  result.steps.push('schedule-filter-prefilled');

  await page.getByRole('link', { name: 'Bereiche' }).click();
  await page.getByRole('heading', { name: 'Bereiche', exact: false }).waitFor({ timeout: 15000 });
  const areaCardAfterReturn = page.locator('.area-card', { has: page.getByRole('heading', { name: areaName, exact: false }) }).first();
  await areaCardAfterReturn.getByRole('button', { name: 'Bereich bearbeiten' }).click();
  await page.locator('input[formcontrolname="name"]').waitFor({ timeout: 5000 });
  result.steps.push('area-edit-opens-form');

  await page.getByRole('link', { name: 'Zeitpläne' }).click();
  await page.waitForURL(/\/schedules$/, { timeout: 15000 });
  await page.getByRole('button', { name: scheduleLabel }).click();
  await page.getByRole('heading', { name: 'Zeitplan anlegen', exact: false }).waitFor({ timeout: 5000 });
  result.steps.push('schedule-create-opens-form');

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('heading', { name: 'Dashboard', exact: false }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Jetzt bewässern' }).click();
  await page.locator('.system-status-card h2').getByText(/Gesamtbewässerung|Bewässerung/).waitFor({ timeout: 8000 });
  result.steps.push('run-all-triggered');

  console.log(JSON.stringify(result));
} finally {
  await fetch(`${apiBaseUrl}/watering/stop-all`, { method: 'POST' }).catch(() => undefined);
  await fetch(`${apiBaseUrl}/system/release-safety-stop`, { method: 'POST' }).catch(() => undefined);
  await cleanupAreaByName(areaName);
  await browser.close();
}
