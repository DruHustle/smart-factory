import importlib.util
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch


FRONTEND = Path(__file__).resolve().parents[2]
FIXTURE = FRONTEND / "deploy/oracle/stage-fixture"
SPEC = importlib.util.spec_from_file_location(
    "prepare_stage_fixture", FRONTEND / "scripts/prepare-stage-fixture.py",
)
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class StageFixtureTests(unittest.TestCase):
    def test_compose_has_no_host_or_external_network_paths(self):
        config = json.loads((FIXTURE / "compose.yaml").read_text())
        self.assertEqual(config["name"], "smart-factory-stage-fixture")
        self.assertEqual(config["networks"], {"fixture": {"internal": True}})
        self.assertEqual(config["volumes"], {"dashboard-data": {}, "telemetry-data": {}})
        forbidden = {"ports", "network_mode", "privileged", "pid", "devices", "env_file", "extra_hosts"}
        for name, service in config["services"].items():
            with self.subTest(service=name):
                self.assertEqual(service["networks"], ["fixture"])
                self.assertFalse(forbidden.intersection(service))
                self.assertGreater(service["cpus"], 0)
                self.assertIn("mem_limit", service)
                for mount in service.get("volumes", []):
                    self.assertNotIn("docker.sock", mount)
                    self.assertNotIn("/opt/", mount)

    def test_worker_uses_the_exact_candidate_and_private_https_after_api_health(self):
        services = json.loads((FIXTURE / "compose.yaml").read_text())["services"]
        api, worker = services["api"], services["worker"]
        self.assertEqual(api["image"], worker["image"])
        for item, role in ((api, "web"), (worker, "worker")):
            with self.subTest(role=role):
                self.assertEqual(item["platform"], "linux/arm64")
                self.assertEqual(item["pull_policy"], "never")
                env = item["environment"]
                self.assertEqual(env["RENDER_SERVICE_ROLE"], role)
                self.assertEqual(env["EMAIL_DELIVERY_CONFIGURED"], "false")
                self.assertEqual(env["ENABLE_DEMO_ACCOUNTS"], "false")
                self.assertEqual(env["MqttBrokerHost"], "broker")
                self.assertIn("@dashboard-db:5432/dashboard_stage", env["DATABASE_URL"])
                self.assertEqual(env["ASSISTANT_PROVIDER"], "disabled")
        self.assertEqual(worker["depends_on"]["api"]["condition"], "service_healthy")
        self.assertIn("/health/ready", api["healthcheck"]["test"][-1])
        self.assertEqual(worker["environment"]["DASHBOARD_API_ORIGIN"], "https://stage-proxy:8443")
        self.assertEqual(worker["environment"]["SSL_CERT_FILE"], "/stage-trust/ca.crt")
        self.assertNotIn("key", "".join(worker["volumes"]))

    def test_fixture_tls_authenticates_only_the_expected_private_proxy(self):
        with tempfile.TemporaryDirectory() as directory:
            object_dir = Path(directory) / "tls"
            subprocess.run(["bash", FIXTURE / "generate-tls.sh", object_dir], check=True, capture_output=True)
            self.assertEqual(object_dir.stat().st_mode & 0o777, 0o700)
            self.assertEqual((object_dir / "proxy.key").stat().st_mode & 0o777, 0o600)
            repeated = subprocess.run(["bash", FIXTURE / "generate-tls.sh", object_dir], capture_output=True)
            self.assertNotEqual(repeated.returncode, 0)

            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(object_dir / "proxy.crt", object_dir / "proxy.key")
            client = ssl.create_default_context(cafile=str(object_dir / "ca.crt"))
            untrusted = ssl.create_default_context()
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                listener.settimeout(4)

                def serve():
                    for _ in range(3):
                        try:
                            raw, _address = listener.accept()
                            with raw, context.wrap_socket(raw, server_side=True) as secure:
                                secure.sendall(b"fixture-ready")
                        except ssl.SSLError:
                            continue

                thread = Thread(target=serve, daemon=True)
                thread.start()
                try:
                    with socket.create_connection(listener.getsockname(), timeout=4) as raw:
                        with client.wrap_socket(raw, server_hostname="stage-proxy") as secured:
                            self.assertEqual(secured.recv(32), b"fixture-ready")
                    for ca, hostname in ((client, "wrong-stage"), (untrusted, "stage-proxy")):
                        with self.assertRaises(ssl.SSLCertVerificationError):
                            with socket.create_connection(listener.getsockname(), timeout=4) as raw:
                                ca.wrap_socket(raw, server_hostname=hostname)
                finally:
                    thread.join(timeout=5)
                self.assertFalse(thread.is_alive())

    def test_exact_packaged_entrypoint_accepts_both_isolated_roles(self):
        spec = importlib.util.spec_from_file_location(
            "stage_fixture_entrypoint", FRONTEND / "deploy/render/entrypoint.py",
        )
        entrypoint = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(entrypoint)
        services = json.loads((FIXTURE / "compose.yaml").read_text())["services"]
        with tempfile.TemporaryDirectory() as directory:
            for name, expected in (("api", "web"), ("worker", "worker")):
                with self.subTest(service=name), patch.dict(os.environ, services[name]["environment"], clear=True), (
                    patch.object(entrypoint, "Path", return_value=Path(directory) / "fixture-ca")
                ):
                    self.assertEqual(entrypoint.configure(), (10000, expected))
                    self.assertEqual(os.environ["WEB_AUTOSTART"], "true" if expected == "web" else "false")
                    self.assertEqual(os.environ["WORKER_AUTOSTART"], "true" if expected == "worker" else "false")
                    if expected == "worker":
                        self.assertEqual(
                            os.environ["INTERNAL_TELEMETRY_SINK_URL"],
                            "https://stage-proxy:8443/api/internal/telemetry",
                        )
                        os.environ["DASHBOARD_API_ORIGIN"] = "http://stage-proxy:8443"
                        with self.assertRaisesRegex(ValueError, "HTTPS web-service origin"):
                            entrypoint.configure()

    def test_untrusted_archive_cannot_create_an_output(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / "bundle.zip"
            bundle.write_bytes(b"not a qualification zip")
            output = Path(directory) / "candidate.tar.gz"
            with self.assertRaisesRegex(ValueError, "trusted receipt"):
                prepare.prepare(bundle, output, "a" * 40, "b" * 64, bundle.stat().st_size)
            self.assertFalse(output.exists())
            linked = Path(directory) / "linked.zip"
            linked.symlink_to(bundle)
            with self.assertRaisesRegex(ValueError, "regular, non-linked"):
                prepare.prepare(linked, output, "a" * 40, "b" * 64, bundle.stat().st_size)


if __name__ == "__main__":
    unittest.main()
