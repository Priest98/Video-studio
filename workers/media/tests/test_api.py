from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_requires_token(monkeypatch):
    monkeypatch.setenv("WORKER_TOKEN", "secret")
    assert client.post("/jobs", json={"source_path": "/nope"}).status_code == 401
    assert client.post("/jobs", json={"source_path": "/nope"}, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/jobs", json={"source_path": "/nope"}, headers={"Authorization": "Bearer secret"}).status_code == 400
    assert client.post("/jobs", json={"source_url": "http://insecure/x"}, headers={"Authorization": "Bearer secret"}).status_code == 400


def test_fails_closed_without_configured_token(monkeypatch):
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    assert client.get("/jobs/x", headers={"Authorization": "Bearer "}).status_code == 401


def test_fetch_source_enforces_size_cap(tmp_path):
    import threading, http.server, functools
    from app.main import fetch_source
    d = tmp_path / "srv"; d.mkdir(); (d / "f.bin").write_bytes(b"x" * 5000)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(d))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/f.bin"
    try:
        assert open(fetch_source(url, str(tmp_path / "o" / "a.bin"), max_bytes=10_000), "rb").read() == b"x" * 5000
        import pytest
        with pytest.raises(ValueError):
            fetch_source(url, str(tmp_path / "o" / "b.bin"), max_bytes=1000)
    finally:
        srv.shutdown()
