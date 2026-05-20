from fastapi.testclient import TestClient

from app.application.kubernetes_status_service import KubernetesStatusService


def test_system_pods_endpoint_returns_unavailable_outside_cluster(client: TestClient) -> None:
    response = client.get("/api/system/pods")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is False
    assert payload["namespace"] == "irrigation"
    assert payload["pods"] == []
    assert "Kubernetes API" in payload["message"]


def test_system_pods_endpoint_returns_pod_status(client: TestClient, monkeypatch) -> None:
    def fake_snapshot(self):
        return {
            "available": True,
            "namespace": "irrigation",
            "message": None,
            "deployments": [
                {
                    "name": "backend",
                    "desired_replicas": 2,
                    "ready_replicas": 1,
                    "available_replicas": 1,
                    "updated_replicas": 1,
                }
            ],
            "pods": [
                {
                    "name": "backend-abc",
                    "app": "backend",
                    "phase": "Running",
                    "ready": True,
                    "ready_containers": 1,
                    "total_containers": 1,
                    "restart_count": 0,
                    "node_name": "pi",
                    "pod_ip": "10.42.0.10",
                    "started_at": "2026-05-20T06:00:00Z",
                    "cpu_millicores": 12.4,
                    "memory_mebibytes": 92.5,
                }
            ],
        }

    monkeypatch.setattr(KubernetesStatusService, "snapshot", fake_snapshot)

    response = client.get("/api/system/pods")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["deployments"][0]["desired_replicas"] == 2
    assert payload["pods"][0]["app"] == "backend"
    assert payload["pods"][0]["cpu_millicores"] == 12.4
