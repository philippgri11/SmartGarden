from __future__ import annotations

import hmac
import json
import re
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response

from app.config import get_settings
from app.logging_config import configure_logging


settings = get_settings()
configure_logging(settings)

app = FastAPI(title="SmartGarden Remote Gate", version="0.1.0")

ZONE_START_RE = re.compile(r"^/api/zones/(?P<zone_id>\d+)/start$")
ZONE_STOP_RE = re.compile(r"^/api/zones/(?P<zone_id>\d+)/stop$")
ZONE_ITEM_RE = re.compile(r"^/api/zones/(?P<zone_id>\d+)$")
SCHEDULE_ITEM_RE = re.compile(r"^/api/schedules/(?P<schedule_id>\d+)$")
MAP_ITEM_RE = re.compile(r"^/api/maps/(?P<map_id>\d+)$")
MAP_VIEW_RE = re.compile(r"^/api/maps/(?P<map_id>\d+)/view$")
MAP_SHAPE_ITEM_RE = re.compile(r"^/api/maps/shapes/(?P<shape_id>\d+)$")

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
}

ZONE_HARDWARE_FIELDS = {"gpio_chip", "gpio_line"}
REMOTE_ACCESS_JWT_HEADER = "X-SmartGarden-Access-Jwt"
REMOTE_ACCESS_SERVICE_TOKEN_HEADER = "X-SmartGarden-Access-Service-Token-Id"
REMOTE_PAGES_PROXY_HEADER = "X-SmartGarden-Pages-Proxy-Id"
CLOUDFLARE_SERVICE_TOKEN_ID_HEADER = "Cf-Access-Client-Id"
CLOUDFLARE_SERVICE_TOKEN_SECRET_HEADER = "Cf-Access-Client-Secret"


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def ready() -> dict[str, str]:
    return {"status": "ok"}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_remote_request(path: str, request: Request) -> Response:
    normalized_path = "/" + path
    if request.method == "OPTIONS":
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    identity = verify_cloudflare_access(request)
    decision = await decide_request(request, normalized_path)
    if not decision.allowed:
        raise HTTPException(status_code=decision.status_code, detail=decision.reason)

    body = decision.body
    if body is None:
        body = await request.body()

    return await forward_request(request, normalized_path, body, identity)


class GateDecision:
    def __init__(self, allowed: bool, reason: str = "", body: bytes | None = None, status_code: int = 403) -> None:
        self.allowed = allowed
        self.reason = reason
        self.body = body
        self.status_code = status_code


def verify_cloudflare_access(request: Request) -> dict[str, Any]:
    if not settings.cloudflare_access_enforce:
        return {"email": "local-dev", "sub": "local-dev"}

    team_domain = settings.cloudflare_access_team_domain
    audiences = [
        item.strip()
        for item in (settings.cloudflare_access_audience or "").split(",")
        if item.strip()
    ]
    if not team_domain or not audiences:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloudflare Access is required but not configured on the remote gate.",
        )

    token = request.headers.get(REMOTE_ACCESS_JWT_HEADER) or request.headers.get("Cf-Access-Jwt-Assertion")
    service_token_id = request.headers.get(CLOUDFLARE_SERVICE_TOKEN_ID_HEADER)
    service_token_secret = request.headers.get(CLOUDFLARE_SERVICE_TOKEN_SECRET_HEADER)
    if service_token_id or service_token_secret:
        if has_valid_service_token_pair(service_token_id, service_token_secret):
            return {"email": "cloudflare-pages-proxy", "sub": "cloudflare-pages-proxy"}
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cloudflare Access service token invalid.")

    pages_proxy_id = request.headers.get(REMOTE_PAGES_PROXY_HEADER) or request.headers.get(REMOTE_ACCESS_SERVICE_TOKEN_HEADER)
    if pages_proxy_id and settings.cloudflare_access_service_token_id and hmac.compare_digest(pages_proxy_id, settings.cloudflare_access_service_token_id):
        return {"email": "cloudflare-pages-proxy", "sub": "cloudflare-pages-proxy"}

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cloudflare Access token missing.")

    import jwt
    from jwt import PyJWKClient

    if not team_domain.endswith(".cloudflareaccess.com"):
        team_domain = f"{team_domain}.cloudflareaccess.com"

    jwks_url = f"https://{team_domain}/cdn-cgi/access/certs"
    try:
        jwk_client = PyJWKClient(jwks_url)
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audiences,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cloudflare Access token invalid.") from exc


def has_valid_service_token_pair(service_token_id: str | None, service_token_secret: str | None) -> bool:
    expected_id = settings.cloudflare_access_service_token_id
    expected_secret = settings.cloudflare_access_service_token_secret
    if not service_token_id or not service_token_secret or not expected_id or not expected_secret:
        return False
    return hmac.compare_digest(service_token_id, expected_id) and hmac.compare_digest(service_token_secret, expected_secret)


async def decide_request(request: Request, path: str) -> GateDecision:
    method = request.method.upper()

    if not path.startswith("/api/"):
        return GateDecision(False, "Only API requests are accepted by the remote gate.", status.HTTP_404_NOT_FOUND)

    if method == "GET" and is_remote_read_path(path):
        return GateDecision(True)

    if method == "POST" and ZONE_START_RE.match(path):
        return await decide_zone_start(request)

    if method == "POST" and (ZONE_STOP_RE.match(path) or path == "/api/watering/stop-all"):
        return GateDecision(True)

    if method == "POST" and path == "/api/watering/run-all":
        if settings.remote_gate_allow_run_all:
            return GateDecision(True)
        return GateDecision(False, "Remote Gesamtbewässerung ist deaktiviert. Nutze einzelne Bereiche oder Stop.", status.HTTP_403_FORBIDDEN)

    if method == "POST" and path in {"/api/system/pause", "/api/system/clear-pause", "/api/system/winter-mode"}:
        return GateDecision(True)

    if method == "POST" and path == "/api/system/release-safety-stop":
        return GateDecision(False, "Safety-Stop darf remote nicht aufgehoben werden.", status.HTTP_403_FORBIDDEN)

    if method == "PUT" and ZONE_ITEM_RE.match(path):
        return await strip_zone_hardware_fields(request)

    if method in {"POST", "PUT", "DELETE"} and is_remote_edit_path(method, path):
        return GateDecision(True)

    return GateDecision(False, f"Remote action not allowed: {method} {path}", status.HTTP_403_FORBIDDEN)


def is_remote_read_path(path: str) -> bool:
    exact = {
        "/api/runtime",
        "/api/system/runtime",
        "/api/system/summary",
        "/api/zones",
        "/api/schedules",
        "/api/schedules/projection",
        "/api/watering/runs",
        "/api/settings",
        "/api/gpio/events",
        "/api/maps",
    }
    return (
        path in exact
        or MAP_VIEW_RE.match(path) is not None
    )


def is_remote_edit_path(method: str, path: str) -> bool:
    if path in {
        "/api/zones/assistant/suggest",
        "/api/zones/assistant/adaptive-plan",
        "/api/zones/assistant/transcribe",
        "/api/schedules",
        "/api/maps",
        "/api/maps/shapes",
        "/api/settings",
    }:
        return True
    if method == "POST" and re.match(r"^/api/zones/\d+/assistant/adjust$", path):
        return True
    return (
        SCHEDULE_ITEM_RE.match(path) is not None
        or MAP_ITEM_RE.match(path) is not None
        or MAP_SHAPE_ITEM_RE.match(path) is not None
    )


async def decide_zone_start(request: Request) -> GateDecision:
    payload = await read_json_object(request)
    duration = payload.get("duration_minutes")
    if not isinstance(duration, int):
        return GateDecision(False, "Remote manual start requires duration_minutes.", status.HTTP_400_BAD_REQUEST)
    if duration < 1:
        return GateDecision(False, "Remote manual start duration must be positive.", status.HTTP_400_BAD_REQUEST)
    if duration > settings.remote_gate_max_manual_duration_minutes:
        return GateDecision(
            False,
            f"Remote manual start is limited to {settings.remote_gate_max_manual_duration_minutes} minutes.",
            status.HTTP_403_FORBIDDEN,
        )
    payload["reason"] = payload.get("reason") or "Remote manual start via Cloudflare Access"
    return GateDecision(True, body=json.dumps(payload).encode("utf-8"))


async def strip_zone_hardware_fields(request: Request) -> GateDecision:
    payload = await read_json_object(request)
    sanitized = {key: value for key, value in payload.items() if key not in ZONE_HARDWARE_FIELDS}
    return GateDecision(True, body=json.dumps(sanitized).encode("utf-8"))


async def read_json_object(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request body must be JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request body must be a JSON object.")
    return payload


async def forward_request(request: Request, path: str, body: bytes, identity: dict[str, Any]) -> Response:
    target = f"{settings.remote_gate_internal_api_base_url.rstrip('/')}{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
        and not key.lower().startswith("cf-access")
        and key.lower() != REMOTE_ACCESS_JWT_HEADER.lower()
        and key.lower() != REMOTE_ACCESS_SERVICE_TOKEN_HEADER.lower()
        and key.lower() != REMOTE_PAGES_PROXY_HEADER.lower()
    }
    headers["x-smartgarden-remote-user"] = str(identity.get("email") or identity.get("sub") or "unknown")
    headers["x-smartgarden-remote-gate"] = "cloudflare-access"

    async with httpx.AsyncClient(timeout=30.0) as client:
        upstream = await client.request(request.method, target, content=body, headers=headers)

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
    return Response(content=upstream.content, status_code=upstream.status_code, headers=response_headers)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
