export interface ZoneIrrigationProfile {
  zoneType: 'lawn' | 'bed' | 'raised_bed' | 'container' | 'greenhouse' | 'hedge' | 'other';
  plantType: 'grass' | 'vegetables' | 'flowers' | 'herbs' | 'shrubs' | 'trees' | 'mixed' | 'unknown';
  sunExposure: 'shade' | 'partial_shade' | 'sunny' | 'full_sun';
  rainExposure: 'none' | 'low' | 'medium' | 'high' | 'full';
  rainEffectiveness: number;
  waterNeedLevel: 'low' | 'medium' | 'high' | 'very_high';
  baseWaterNeedMmPerDay: number;
  temperatureSensitivity: number;
  sunSensitivity: number;
  containerFactor: number;
  dryingSpeed: 'slow' | 'normal' | 'fast' | 'very_fast';
  wateringFrequencyPreference: 'rare_deep' | 'normal' | 'frequent_short';
  preferredTimeWindow: 'early_morning' | 'morning' | 'evening' | 'morning_and_evening';
  strategy: 'water_saving' | 'balanced' | 'growth_oriented';
  riskProfile: 'avoid_overwatering' | 'balanced' | 'avoid_drought_stress';
  explanation: string;
}

export interface ZoneProfileDiffItem {
  field: keyof ZoneIrrigationProfile | string;
  label: string;
  before_display: string;
  after_display: string;
}

export interface ZoneProfileSuggestionRequest {
  description: string;
  current_profile?: ZoneIrrigationProfile | null;
}

export interface ZoneProfileAdjustmentRequest {
  instruction: string;
  description?: string | null;
  current_profile?: ZoneIrrigationProfile | null;
}

export interface ZoneProfileSuggestionResponse {
  profile: ZoneIrrigationProfile;
  explanation: string;
  warnings: string[];
  summary: string[];
  diff: ZoneProfileDiffItem[];
}

export interface AdaptiveIrrigationPlan {
  irrigationMethod: 'sprinkler' | 'drip' | 'soaker_hose' | 'manual' | 'unknown';
  preferredTimeWindows: Array<'early_morning' | 'morning' | 'evening' | 'morning_and_evening'>;
  avoidMidday: boolean;
  allowSecondDailyRun: boolean;
  minIntervalHours: number;
  baseDurationMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  rainSkipThresholdMm: number;
  rainDelayThresholdMm: number;
  heatThresholdC: number;
  highNeedThresholdMm: number;
  rules: string[];
  explanation: string;
}

export interface ZoneAdaptivePlanRequest {
  description?: string | null;
  profile: ZoneIrrigationProfile;
  max_duration_minutes: number;
}

export interface ZoneAdaptivePlanResponse {
  plan: AdaptiveIrrigationPlan;
  warnings: string[];
  explanation: string;
  summary: string[];
}

export interface ZoneAssistantTranscriptionResponse {
  text: string;
}

export interface Zone {
  id: number;
  name: string;
  description?: string | null;
  zone_profile_description?: string | null;
  irrigation_profile?: ZoneIrrigationProfile | null;
  scheduling_mode: 'static' | 'adaptive';
  adaptive_irrigation_plan?: AdaptiveIrrigationPlan | null;
  gpio_chip: string;
  gpio_line: number;
  active: boolean;
  default_manual_duration_minutes: number;
  max_duration_minutes: number;
  weather_enabled: boolean;
  weather_probability_threshold?: number | null;
  weather_precipitation_mm_threshold?: number | null;
  status: 'disabled' | 'active' | 'watering' | 'scheduled-soon' | 'paused' | 'error';
  run_state: 'idle' | 'queued' | 'running' | 'stopping';
  running: boolean;
  current_run_id?: number | null;
  current_run_status?: string | null;
  current_run_started_at?: string | null;
  current_run_requested_duration_minutes?: number | null;
  current_run_remaining_seconds?: number | null;
  current_run_stop_requested: boolean;
  last_known_gpio_state: boolean;
  last_gpio_changed_at?: string | null;
  next_watering_at?: string | null;
  last_watering_at?: string | null;
  last_run_status?: string | null;
  last_weather_decision?: string | null;
  last_weather_reason?: string | null;
  weather_decision_effective: boolean;
  weather_decision?: 'allow' | 'skip' | 'error' | 'inactive' | 'unknown' | null;
  weather_reason_human?: string | null;
  weather_snapshot?: WeatherOverview | null;
  manual_start_allowed: boolean;
  manual_start_block_reason?: string | null;
  active_shape_count: number;
}

export interface Schedule {
  id: number;
  zone_id: number;
  active: boolean;
  weekdays: string[];
  start_time: string;
  duration_minutes: number;
  interval_hours?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  weather_enabled: boolean;
  weather_probability_threshold?: number | null;
  weather_precipitation_mm_threshold?: number | null;
}

export interface IrrigationProjectionItem {
  zone_id: number;
  zone_name: string;
  schedule_id?: number | null;
  source: 'manual_rule' | 'adaptive_rule';
  status: 'planned' | 'skipped' | 'blocked';
  planned_start: string;
  planned_end: string;
  original_start: string;
  duration_minutes: number;
  reason: string;
  weather_summary?: string | null;
  adjusted_for_sequence: boolean;
}

export interface IrrigationProjection {
  generated_at: string;
  days: number;
  weather_source_status: 'fresh' | 'stale' | 'unavailable';
  items: IrrigationProjectionItem[];
}

export interface WeatherDecision {
  id: number;
  decision: string;
  reason: string;
  reason_human?: string | null;
  checked_at: string;
  precipitation_probability_max?: number | null;
  precipitation_sum_mm?: number | null;
}

export interface WeatherOverview {
  weather_enabled: boolean;
  decision: 'allow' | 'skip' | 'error' | 'inactive' | 'unknown';
  headline: string;
  summary_text: string;
  current_condition_label?: string | null;
  current_weather_code?: number | null;
  current_is_day?: boolean | null;
  current_temperature_c?: number | null;
  temperature_max_24h_c?: number | null;
  precipitation_last_24h_mm?: number | null;
  precipitation_next_24h_mm?: number | null;
  cloud_cover_avg_pct?: number | null;
  forecast_window_hours: number;
  precipitation_probability_max?: number | null;
  precipitation_sum_mm?: number | null;
  probability_threshold: number;
  precipitation_threshold_mm: number;
  fail_mode: 'allow' | 'deny';
  source_status: 'fresh' | 'stale' | 'unavailable';
  checked_at?: string | null;
  reason_human: string;
  irrigation_recommendation?: ZoneIrrigationRecommendation | null;
}

export interface ZoneIrrigationRecommendation {
  decision: 'allow' | 'skip';
  adjusted_duration_minutes: number;
  scheduled_duration_minutes: number;
  estimated_need_mm: number;
  effective_rain_mm: number;
  net_need_mm: number;
  multiplier: number;
  explanation: string;
  details: string[];
}

export interface WateringRun {
  id: number;
  zone_id: number;
  schedule_id?: number | null;
  trigger_type: string;
  status: string;
  scheduled_for?: string | null;
  requested_duration_minutes: number;
  sequence_group_id?: string | null;
  sequence_order?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_seconds?: number | null;
  stop_requested: boolean;
  reason?: string | null;
  created_at: string;
  weather_decisions: WeatherDecision[];
}

export interface AppSettings {
  location_name: string;
  postal_code?: string | null;
  latitude: number;
  longitude: number;
  weather_enabled: boolean;
  weather_window_hours: number;
  weather_probability_threshold: number;
  weather_precipitation_mm_threshold: number;
  weather_fail_mode: 'allow' | 'deny';
  winter_mode_active: boolean;
  winter_disable_manual_start: boolean;
  winter_pause_schedules: boolean;
  safety_shutdown_on_winter: boolean;
  system_paused_until?: string | null;
  safety_stop_active: boolean;
  safety_stop_reason?: string | null;
}

export interface GpioEvent {
  id: number;
  zone_id: number;
  state: boolean;
  source: string;
  reason?: string | null;
  created_at: string;
}

export interface GardenMap {
  id: number;
  name: string;
  image_url?: string | null;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

export interface ZoneMapShape {
  id: number;
  garden_map_id: number;
  zone_id: number;
  name: string;
  geometry_json: GeoJSON.Feature<GeoJSON.Geometry>;
  style_json?: Record<string, unknown> | null;
  label_position_x?: number | null;
  label_position_y?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ZoneMapZoneStatus {
  zone_id: number;
  id: number;
  name: string;
  description?: string | null;
  gpio_chip: string;
  gpio_line: number;
  active: boolean;
  default_manual_duration_minutes: number;
  weather_probability_threshold?: number | null;
  weather_precipitation_mm_threshold?: number | null;
  status: 'disabled' | 'active' | 'watering' | 'scheduled-soon' | 'paused' | 'error';
  run_state: 'idle' | 'queued' | 'running' | 'stopping';
  running: boolean;
  current_run_id?: number | null;
  current_run_status?: string | null;
  current_run_started_at?: string | null;
  current_run_requested_duration_minutes?: number | null;
  current_run_remaining_seconds?: number | null;
  current_run_stop_requested: boolean;
  last_known_gpio_state: boolean;
  last_gpio_changed_at?: string | null;
  next_watering_at?: string | null;
  last_watering_at?: string | null;
  weather_enabled: boolean;
  last_run_status?: string | null;
  last_weather_decision?: string | null;
  last_weather_reason?: string | null;
  weather_decision_effective: boolean;
  weather_decision?: 'allow' | 'skip' | 'error' | 'inactive' | 'unknown' | null;
  weather_reason_human?: string | null;
  weather_snapshot?: WeatherOverview | null;
  manual_start_allowed: boolean;
  manual_start_block_reason?: string | null;
  active_shape_count: number;
  max_duration_minutes: number;
}

export interface ZoneMapShapeView extends ZoneMapShape {
  zone_status: ZoneMapZoneStatus;
}

export interface GardenMapView {
  map: GardenMap;
  shapes: ZoneMapShapeView[];
}

export interface SystemSummary {
  status: 'ok' | 'running' | 'paused' | 'winter' | 'attention';
  headline: string;
  detail: string;
  current_water_status: string;
  next_watering_at?: string | null;
  weather_status: string;
  weather_overview: WeatherOverview;
  active_schedule_count: number;
  running_zone_count: number;
  winter_mode_active: boolean;
  safety_stop_active: boolean;
  system_paused_until?: string | null;
  last_run_zone_name?: string | null;
  last_run_finished_at?: string | null;
  last_run_status?: string | null;
  manual_sequence_active: boolean;
  manual_sequence_current_area_name?: string | null;
  manual_sequence_total_areas: number;
  manual_sequence_completed_areas: number;
  manual_sequence_skipped_schedule_count: number;
  manual_sequence_notice?: string | null;
}

export interface RuntimeSnapshot {
  generated_at: string;
  settings: AppSettings;
  summary: SystemSummary;
  areas: Zone[];
}

export interface SystemPodStatus {
  name: string;
  app?: string | null;
  phase: string;
  ready: boolean;
  ready_containers: number;
  total_containers: number;
  restart_count: number;
  node_name?: string | null;
  pod_ip?: string | null;
  started_at?: string | null;
  cpu_millicores?: number | null;
  memory_mebibytes?: number | null;
}

export interface SystemDeploymentStatus {
  name: string;
  desired_replicas: number;
  ready_replicas: number;
  available_replicas: number;
  updated_replicas: number;
}

export interface SystemPodsResponse {
  available: boolean;
  namespace: string;
  message?: string | null;
  deployments: SystemDeploymentStatus[];
  pods: SystemPodStatus[];
}

export interface RunAllAreasResponse {
  message: string;
  queued_run_count: number;
  skipped_schedule_count: number;
  sequence_group_id: string;
}

export interface PauseSystemPayload {
  hours: number;
}

export interface WinterModePayload {
  active: boolean;
  disable_manual_start: boolean;
  pause_schedules: boolean;
  safety_shutdown: boolean;
}
