from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from app.config import Settings


SERVICE_ACCOUNT_DIR = Path("/var/run/secrets/kubernetes.io/serviceaccount")
TOKEN_PATH = SERVICE_ACCOUNT_DIR / "token"
CA_PATH = SERVICE_ACCOUNT_DIR / "ca.crt"
NAMESPACE_PATH = SERVICE_ACCOUNT_DIR / "namespace"


class KubernetesStatusService:
    def __init__(self, settings: Settings):
        self.settings = settings

    def snapshot(self) -> dict[str, Any]:
        namespace = self._namespace()
        try:
            pods_response = self._request_json(f"/api/v1/namespaces/{namespace}/pods")
        except RuntimeError as exc:
            return {
                "available": False,
                "namespace": namespace,
                "message": str(exc),
                "pods": [],
            }

        metrics = self._pod_metrics(namespace)
        return {
            "available": True,
            "namespace": namespace,
            "message": None,
            "pods": [self._pod_status(item, metrics.get(item.get("metadata", {}).get("name", ""))) for item in pods_response.get("items", [])],
        }

    def _namespace(self) -> str:
        if NAMESPACE_PATH.exists():
            content = NAMESPACE_PATH.read_text(encoding="utf-8").strip()
            if content:
                return content
        return self.settings.kubernetes_namespace

    def _pod_metrics(self, namespace: str) -> dict[str, dict[str, Any]]:
        try:
            response = self._request_json(f"/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods")
        except RuntimeError:
            return {}
        return {item.get("metadata", {}).get("name", ""): item for item in response.get("items", [])}

    def _request_json(self, path: str) -> dict[str, Any]:
        host = os.environ.get("KUBERNETES_SERVICE_HOST")
        port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
        if not host:
            raise RuntimeError("Kubernetes API ist in dieser Umgebung nicht verfügbar.")
        if not TOKEN_PATH.exists():
            raise RuntimeError("Kubernetes Service-Account-Token ist nicht verfügbar.")

        token = TOKEN_PATH.read_text(encoding="utf-8").strip()
        request = urllib.request.Request(
            f"https://{host}:{port}{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        context = ssl.create_default_context(cafile=str(CA_PATH)) if CA_PATH.exists() else ssl.create_default_context()
        try:
            with urllib.request.urlopen(request, context=context, timeout=2.5) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 403:
                raise RuntimeError("Kubernetes-Berechtigung zum Lesen der Pods fehlt.") from exc
            if exc.code == 404:
                raise RuntimeError("Kubernetes-Endpoint ist nicht verfügbar.") from exc
            raise RuntimeError(f"Kubernetes API antwortet mit HTTP {exc.code}.") from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Kubernetes API konnte nicht gelesen werden.") from exc

    def _pod_status(self, pod: dict[str, Any], metrics: dict[str, Any] | None) -> dict[str, Any]:
        metadata = pod.get("metadata", {})
        status = pod.get("status", {})
        spec = pod.get("spec", {})
        containers = status.get("containerStatuses", [])
        ready_containers = sum(1 for item in containers if item.get("ready"))
        total_containers = len(containers)
        restart_count = sum(int(item.get("restartCount") or 0) for item in containers)
        app = metadata.get("labels", {}).get("app") or metadata.get("labels", {}).get("app.kubernetes.io/name")
        return {
            "name": metadata.get("name", ""),
            "app": app,
            "phase": status.get("phase", "Unknown"),
            "ready": total_containers > 0 and ready_containers == total_containers,
            "ready_containers": ready_containers,
            "total_containers": total_containers,
            "restart_count": restart_count,
            "node_name": spec.get("nodeName"),
            "pod_ip": status.get("podIP"),
            "started_at": status.get("startTime"),
            "cpu_millicores": self._cpu_millicores(metrics),
            "memory_mebibytes": self._memory_mebibytes(metrics),
        }

    def _cpu_millicores(self, metrics: dict[str, Any] | None) -> float | None:
        if not metrics:
            return None
        return sum(self._parse_cpu(container.get("usage", {}).get("cpu")) for container in metrics.get("containers", []))

    def _memory_mebibytes(self, metrics: dict[str, Any] | None) -> float | None:
        if not metrics:
            return None
        return sum(self._parse_memory(container.get("usage", {}).get("memory")) for container in metrics.get("containers", []))

    @staticmethod
    def _parse_cpu(value: str | None) -> float:
        if not value:
            return 0.0
        if value.endswith("n"):
            return float(value[:-1]) / 1_000_000
        if value.endswith("u"):
            return float(value[:-1]) / 1_000
        if value.endswith("m"):
            return float(value[:-1])
        return float(value) * 1000

    @staticmethod
    def _parse_memory(value: str | None) -> float:
        if not value:
            return 0.0
        units = {
            "Ki": 1 / 1024,
            "Mi": 1,
            "Gi": 1024,
            "Ti": 1024 * 1024,
            "K": 1000 / 1024 / 1024,
            "M": 1000 * 1000 / 1024 / 1024,
            "G": 1000 * 1000 * 1000 / 1024 / 1024,
        }
        for suffix, factor in units.items():
            if value.endswith(suffix):
                return float(value[: -len(suffix)]) * factor
        return float(value) / 1024 / 1024
