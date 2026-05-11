from fastapi.testclient import TestClient
from app.infrastructure.weather.open_meteo_client import WeatherForecastSummary

from conftest import create_zone_payload


def test_runtime_snapshot_reflects_manual_start_and_safety_stop(client: TestClient) -> None:
    zone = client.post("/api/zones", json=create_zone_payload("Gemuesebeet Nord", 11)).json()

    before_start = client.get("/api/runtime").json()
    assert before_start["areas"][0]["run_state"] == "idle"
    assert before_start["areas"][0]["manual_start_allowed"] is True
    assert "weather_overview" in before_start["summary"]
    assert before_start["summary"]["weather_overview"]["decision"] in {"inactive", "unknown"}
    assert "weather_snapshot" in before_start["areas"][0]

    start_response = client.post(f"/api/zones/{zone['id']}/start", json={"duration_minutes": 4})
    assert start_response.status_code == 202

    queued_runtime = client.get("/api/runtime").json()
    area = queued_runtime["areas"][0]
    assert area["run_state"] == "queued"
    assert area["current_run_status"] == "planned"
    assert area["manual_start_allowed"] is False
    assert queued_runtime["summary"]["headline"] == "Bewässerung wird vorbereitet"
    assert queued_runtime["summary"]["current_water_status"] == "wird vorbereitet"

    stop_all_response = client.post("/api/watering/stop-all")
    assert stop_all_response.status_code == 200

    stopped_runtime = client.get("/api/runtime").json()
    assert stopped_runtime["settings"]["safety_stop_active"] is True
    assert stopped_runtime["summary"]["status"] == "attention"
    assert stopped_runtime["areas"][0]["status"] == "error"
    assert stopped_runtime["areas"][0]["manual_start_allowed"] is False

    release_response = client.post("/api/system/release-safety-stop")
    assert release_response.status_code == 200

    released_runtime = client.get("/api/runtime").json()
    assert released_runtime["settings"]["safety_stop_active"] is False
    assert released_runtime["areas"][0]["status"] == "active"


def test_runtime_snapshot_keeps_area_activation_deterministic(client: TestClient) -> None:
    first = client.post("/api/zones", json=create_zone_payload("Rasen Vorne", 21)).json()
    second = client.post("/api/zones", json=create_zone_payload("Rasen Hinten", 22)).json()

    update_response = client.put(f"/api/zones/{second['id']}", json=create_zone_payload("Rasen Hinten", 22, active=False))
    assert update_response.status_code == 200

    runtime = client.get("/api/runtime").json()
    areas_by_id = {area["id"]: area for area in runtime["areas"]}

    assert areas_by_id[first["id"]]["status"] == "active"
    assert areas_by_id[first["id"]]["active"] is True
    assert areas_by_id[second["id"]]["status"] == "disabled"
    assert areas_by_id[second["id"]]["active"] is False


def test_delete_zone_with_related_runtime_records_succeeds(client: TestClient) -> None:
    zone = client.post("/api/zones", json=create_zone_payload("Loeschtest", 31)).json()
    start_response = client.post(f"/api/zones/{zone['id']}/start", json={"duration_minutes": 3})
    assert start_response.status_code == 202

    delete_response = client.delete(f"/api/zones/{zone['id']}")
    assert delete_response.status_code == 204

    runtime = client.get("/api/runtime").json()
    assert runtime["areas"] == []


def test_run_all_areas_queues_sequence_and_updates_runtime_summary(client: TestClient) -> None:
    teich = client.post("/api/zones", json=create_zone_payload("Teich", 41, default_minutes=4)).json()
    terrasse = client.post("/api/zones", json=create_zone_payload("Terrasse", 42, default_minutes=3)).json()

    run_all_response = client.post("/api/watering/run-all")
    assert run_all_response.status_code == 202
    payload = run_all_response.json()
    assert payload["queued_run_count"] == 2

    runtime = client.get("/api/runtime").json()
    assert runtime["summary"]["manual_sequence_active"] is True
    assert runtime["summary"]["manual_sequence_total_areas"] == 2
    assert runtime["summary"]["headline"] == "Gesamtbewässerung wird vorbereitet"


def test_runs_endpoint_includes_human_weather_reason(client: TestClient) -> None:
    zone = client.post("/api/zones", json=create_zone_payload("Wettertest", 51)).json()
    start_response = client.post(f"/api/zones/{zone['id']}/start", json={"duration_minutes": 3})
    assert start_response.status_code == 202

    runs = client.get("/api/watering/runs").json()
    first_run = runs[0]
    assert "weather_decisions" in first_run
    if first_run["weather_decisions"]:
        assert "reason_human" in first_run["weather_decisions"][0]


def test_runtime_snapshot_refreshes_weather_values_when_stored_decision_is_incomplete(client: TestClient, monkeypatch) -> None:
    zone = client.post(
        "/api/zones",
        json={
            **create_zone_payload("Wetter live", 61),
            "weather_enabled": True,
            "weather_probability_threshold": 70,
            "weather_precipitation_mm_threshold": 2.0,
        },
    ).json()
    start_response = client.post(f"/api/zones/{zone['id']}/start", json={"duration_minutes": 3})
    assert start_response.status_code == 202

    def fake_fetch_forecast(self, *, latitude: float, longitude: float, hours: int):
        return WeatherForecastSummary(
            probability_max=35,
            precipitation_sum_mm=0.2,
            current_weather_code=2,
            current_is_day=True,
            current_temperature_c=19.5,
            raw_response={"mock": True},
        )

    monkeypatch.setattr(
        "app.infrastructure.weather.open_meteo_client.OpenMeteoClient.fetch_forecast",
        fake_fetch_forecast,
    )

    runtime = client.get("/api/runtime").json()
    area = next(item for item in runtime["areas"] if item["id"] == zone["id"])

    assert area["weather_snapshot"]["precipitation_probability_max"] == 35
    assert area["weather_snapshot"]["precipitation_sum_mm"] == 0.2
    assert "35 %" in area["weather_snapshot"]["summary_text"]
