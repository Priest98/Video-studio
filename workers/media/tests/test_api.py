from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_requires_token(monkeypatch):
    monkeypatch.setenv("WORKER_TOKEN", "secret")
    assert client.post("/jobs", json={"source_path": "/nope"}).status_code == 401
    assert client.post("/jobs", json={"source_path": "/nope"}, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/jobs", json={"source_path": "/nope"}, headers={"Authorization": "Bearer secret"}).status_code == 400


def test_fails_closed_without_configured_token(monkeypatch):
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    assert client.get("/jobs/x", headers={"Authorization": "Bearer "}).status_code == 401
