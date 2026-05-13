import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4200';
const areaName = `E2E Fester Zeitplan ${Date.now()}`;
const posts = [];

const emptyWeatherOverview = {
  weather_enabled: false,
  decision: 'inactive',
  headline: 'Wettersteuerung aus',
  summary_text: 'Wetter wird nicht berücksichtigt.',
  forecast_window_hours: 6,
  probability_threshold: 70,
  precipitation_threshold_mm: 2,
  fail_mode: 'allow',
  source_status: 'fresh',
  checked_at: null,
  reason_human: 'Wettersteuerung ist deaktiviert.',
  irrigation_recommendation: null,
};

const runtimeSnapshot = {
  generated_at: '2026-05-13T08:00:00+02:00',
  settings: {
    location_name: 'E2E Garten',
    postal_code: '10115',
    latitude: 52.52,
    longitude: 13.405,
    weather_enabled: true,
    weather_window_hours: 6,
    weather_probability_threshold: 70,
    weather_precipitation_mm_threshold: 2,
    weather_fail_mode: 'allow',
    winter_mode_active: false,
    winter_disable_manual_start: true,
    winter_pause_schedules: true,
    safety_shutdown_on_winter: true,
    system_paused_until: null,
    safety_stop_active: false,
    safety_stop_reason: null,
  },
  summary: {
    status: 'ok',
    headline: 'Alles in Ordnung',
    detail: 'Das System ist bereit.',
    current_water_status: 'Ventile geschlossen',
    next_watering_at: null,
    weather_status: 'Wetter ok',
    weather_overview: emptyWeatherOverview,
    active_schedule_count: 0,
    running_zone_count: 0,
    winter_mode_active: false,
    safety_stop_active: false,
    system_paused_until: null,
    last_run_zone_name: null,
    last_run_finished_at: null,
    last_run_status: null,
    manual_sequence_active: false,
    manual_sequence_current_area_name: null,
    manual_sequence_total_areas: 0,
    manual_sequence_completed_areas: 0,
    manual_sequence_skipped_schedule_count: 0,
    manual_sequence_notice: null,
  },
  areas: [],
};

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function createdZoneFrom(payload) {
  return {
    id: 999,
    status: 'active',
    run_state: 'idle',
    running: false,
    current_run_id: null,
    current_run_status: null,
    current_run_started_at: null,
    current_run_requested_duration_minutes: null,
    current_run_remaining_seconds: null,
    current_run_stop_requested: false,
    last_known_gpio_state: false,
    last_gpio_changed_at: null,
    next_watering_at: null,
    last_watering_at: null,
    last_run_status: null,
    last_weather_decision: null,
    last_weather_reason: null,
    weather_decision_effective: false,
    weather_decision: 'inactive',
    weather_reason_human: 'Wettersteuerung ist deaktiviert.',
    weather_snapshot: emptyWeatherOverview,
    manual_start_allowed: true,
    manual_start_block_reason: null,
    active_shape_count: 0,
    ...payload,
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

try {
  await page.route('**/api/**', (route) => route.fulfill(jsonResponse({})));

  await page.route('**/api/runtime', (route) => route.fulfill(jsonResponse(runtimeSnapshot)));

  await page.route('**/api/zones', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    const payload = route.request().postDataJSON();
    posts.push({ kind: 'zone', payload });
    await route.fulfill(jsonResponse(createdZoneFrom(payload), 201));
  });

  await page.route('**/api/schedules', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    const payload = route.request().postDataJSON();
    posts.push({ kind: 'schedule', payload });
    await route.fulfill(jsonResponse({ id: 1234, ...payload }, 201));
  });

  await page.goto(`${baseUrl}/areas`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Bereiche', exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Bereich anlegen' }).click();
  await page.locator('input[formcontrolname="name"]').fill(areaName);
  await page.getByRole('button', { name: 'Automatik wählen' }).click();
  await page.getByText('Fester Zeitplan', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('Dieser Zeitplan wird beim Anlegen des Bereichs direkt mitgespeichert.').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Bereich anlegen' }).last().click();

  for (let attempt = 0; attempt < 30 && posts.length < 2; attempt += 1) {
    await page.waitForTimeout(100);
  }

  const zonePost = posts.find((post) => post.kind === 'zone');
  const schedulePost = posts.find((post) => post.kind === 'schedule');
  if (!zonePost) {
    throw new Error('Expected a POST /api/zones when creating a fixed-schedule area.');
  }
  if (!schedulePost) {
    throw new Error('Expected a POST /api/schedules after fixed-schedule area creation.');
  }

  const zone = zonePost.payload;
  if (zone.name !== areaName) {
    throw new Error(`Expected zone name "${areaName}", got "${zone.name}".`);
  }
  if (zone.scheduling_mode !== 'static') {
    throw new Error(`Expected static scheduling_mode, got "${zone.scheduling_mode}".`);
  }
  if (zone.adaptive_irrigation_plan !== null) {
    throw new Error('Expected no adaptive plan for a fixed-schedule area.');
  }

  const schedule = schedulePost.payload;
  const expectedWeekdays = ['mon', 'wed', 'fri'];
  if (schedule.zone_id !== 999) {
    throw new Error(`Expected schedule for created zone 999, got ${schedule.zone_id}.`);
  }
  if (JSON.stringify(schedule.weekdays) !== JSON.stringify(expectedWeekdays)) {
    throw new Error(`Expected weekdays ${expectedWeekdays.join(',')}, got ${schedule.weekdays?.join(',')}.`);
  }
  if (schedule.start_time !== '06:00' || schedule.duration_minutes !== 5) {
    throw new Error(`Expected 06:00 for 5 minutes, got ${schedule.start_time} for ${schedule.duration_minutes}.`);
  }
  if (schedule.weather_enabled !== false) {
    throw new Error('Expected weather to be disabled on the default fixed schedule.');
  }

  console.log(JSON.stringify({
    areaName,
    zonePost: zone,
    schedulePost: schedule,
    result: 'fixed-schedule-area-creates-zone-and-schedule',
  }));
} finally {
  await browser.close();
}
