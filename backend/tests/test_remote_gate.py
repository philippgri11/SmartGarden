import json

from fastapi.testclient import TestClient
from fastapi import Response

from app import remote_gate


def _client(monkeypatch):
    monkeypatch.setattr(remote_gate.settings, "cloudflare_access_enforce", False)
    return TestClient(remote_gate.app)


def test_remote_gate_allows_read_requests(monkeypatch):
    captured = {}

    async def fake_forward(request, path, body, identity):
        captured["path"] = path
        captured["identity"] = identity
        return Response(content=b'{"ok": true}', media_type="application/json")

    monkeypatch.setattr(remote_gate, "forward_request", fake_forward)
    client = _client(monkeypatch)

    response = client.get("/api/runtime")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert captured["path"] == "/api/runtime"
    assert captured["identity"]["email"] == "local-dev"


def test_remote_gate_limits_remote_manual_start(monkeypatch):
    monkeypatch.setattr(remote_gate.settings, "remote_gate_max_manual_duration_minutes", 5)
    client = _client(monkeypatch)

    response = client.post("/api/zones/3/start", json={"duration_minutes": 8})

    assert response.status_code == 403
    assert "limited to 5 minutes" in response.json()["detail"]


def test_remote_gate_strips_gpio_fields_from_zone_update(monkeypatch):
    captured = {}

    async def fake_forward(request, path, body, identity):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return Response(content=json.dumps(captured["payload"]), media_type="application/json")

    monkeypatch.setattr(remote_gate, "forward_request", fake_forward)
    client = _client(monkeypatch)

    response = client.put(
        "/api/zones/7",
        json={
            "name": "Terrasse",
            "gpio_chip": "/dev/gpiochip1",
            "gpio_line": 23,
            "active": True,
        },
    )

    assert response.status_code == 200
    assert captured["payload"] == {"name": "Terrasse", "active": True}


def test_remote_gate_blocks_run_all_by_default(monkeypatch):
    client = _client(monkeypatch)

    response = client.post("/api/watering/run-all", json={})

    assert response.status_code == 403
    assert "Gesamtbewässerung" in response.json()["detail"]
