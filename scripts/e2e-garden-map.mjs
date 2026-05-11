import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:8080';
const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8000/api';
const mapName = `E2E Map ${Date.now()}`;
const mapNameUpdated = `${mapName} Updated`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadImagePath = path.resolve(__dirname, '../frontend/src/assets/garden-placeholder.svg');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function cleanupMapByName(name) {
  const response = await fetch(`${apiBaseUrl}/maps`);
  if (!response.ok) {
    return;
  }
  const maps = await response.json();
  const target = maps.find((item) => item.name === name);
  if (target) {
    await fetch(`${apiBaseUrl}/maps/${target.id}`, { method: 'DELETE' });
  }
}

try {
  const result = { mapName, mapNameUpdated, steps: [] };

  await page.goto(`${baseUrl}/garden-map`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Gartenkarte', exact: true }).waitFor({ timeout: 15000 });
  result.steps.push('page-loaded');

  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await page.locator('input[formcontrolname="name"]').first().fill(mapName);
  await page.locator('input[type="file"]').first().setInputFiles(uploadImagePath);
  await page.getByRole('button', { name: 'Karte anlegen', exact: true }).click();
  await page.getByText('Karte angelegt.', { exact: false }).waitFor({ timeout: 15000 });
  result.steps.push('map-created');

  await page.locator('input[formcontrolname="name"]').first().fill(mapNameUpdated);
  await page.getByRole('button', { name: 'Karte speichern', exact: true }).click();
  await page.getByText('Karte gespeichert.', { exact: false }).waitFor({ timeout: 15000 });
  result.steps.push('map-updated');

  console.log(JSON.stringify(result));
} finally {
  await cleanupMapByName(mapNameUpdated);
  await cleanupMapByName(mapName);
  await browser.close();
}
