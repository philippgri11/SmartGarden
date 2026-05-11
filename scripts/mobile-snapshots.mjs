import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ headless: true });
const mobileContext = await browser.newContext({
  viewport: { width: 378, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
});
const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 2,
});

const mobilePage = await mobileContext.newPage();
const desktopPage = await desktopContext.newPage();

const mobileShots = [
  { path: '/dashboard', file: '/tmp/irrigation-dashboard-iphone.png' },
  { path: '/garden-map', file: '/tmp/irrigation-garden-map-iphone.png' },
  { path: '/schedules', file: '/tmp/irrigation-schedules-iphone.png' },
];

const desktopShots = [
  { path: '/schedules', file: '/tmp/irrigation-schedules-desktop.png' },
];

for (const shot of mobileShots) {
  await mobilePage.goto(`${baseUrl}${shot.path}`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: shot.file, fullPage: true });
}

for (const shot of desktopShots) {
  await desktopPage.goto(`${baseUrl}${shot.path}`, { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: shot.file, fullPage: true });
}

console.log(JSON.stringify([...mobileShots, ...desktopShots]));

await mobileContext.close();
await desktopContext.close();
await browser.close();
