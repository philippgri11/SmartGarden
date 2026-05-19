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
    with _client(monkeypatch) as client:
        response = client.get("/api/runtime")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert captured["path"] == "/api/runtime"
    assert captured["identity"]["email"] == "local-dev"


def test_remote_gate_limits_remote_manual_start(monkeypatch):
    monkeypatch.setattr(remote_gate.settings, "remote_gate_max_manual_duration_minutes", 5)
    with _client(monkeypatch) as client:
        response = client.post("/api/zones/3/start", json={"duration_minutes": 8})

    assert response.status_code == 403
    assert "limited to 5 minutes" in response.json()["detail"]


def test_remote_gate_strips_gpio_fields_from_zone_update(monkeypatch):
    captured = {}

    async def fake_forward(request, path, body, identity):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return Response(content=json.dumps(captured["payload"]), media_type="application/json")

    monkeypatch.setattr(remote_gate, "forward_request", fake_forward)
    with _client(monkeypatch) as client:
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
    with _client(monkeypatch) as client:
        response = client.post("/api/watering/run-all", json={})

    assert response.status_code == 403
    assert "Gesamtbewässerung" in response.json()["detail"]


def test_remote_gate_requires_access_token_when_enforced(monkeypatch):
    monkeypatch.setattr(remote_gate.settings, "cloudflare_access_enforce", True)
    monkeypatch.setattr(remote_gate.settings, "cloudflare_access_team_domain", "example.cloudflareaccess.com")
    monkeypatch.setattr(remote_gate.settings, "cloudflare_access_audience", "aud-1,aud-2")
    with TestClient(remote_gate.app) as client:
        response = client.get("/api/runtime")

    assert response.status_code == 401
    assert response.json()["detail"] == "Cloudflare Access token missing."


def test_remote_gate_accepts_forwarded_pages_access_jwt(monkeypatch):
    captured = {}

    def fake_verify(request):
        assert request.headers["X-SmartGarden-Access-Jwt"] == "ui-jwt"
        return {"email": "user@example.org"}

    async def fake_forward(request, path, body, identity):
        captured["identity"] = identity
        captured["forwarded_headers"] = dict(request.headers)
        return Response(content=b'{"ok": true}', media_type="application/json")

    monkeypatch.setattr(remote_gate.settings, "cloudflare_access_enforce", True)
    monkeypatch.setattr(remote_gate, "verify_cloudflare_access", fake_verify)
    monkeypatch.setattr(remote_gate, "forward_request", fake_forward)
    with TestClient(remote_gate.app) as client:
        response = client.get("/api/runtime", headers={"X-SmartGarden-Access-Jwt": "ui-jwt"})

    assert response.status_code == 200
    assert captured["identity"]["email"] == "user@example.org"
