"""Keep production examples aligned with the Factory cutover destinations.

These are offline template contracts, not proof of a deployed broker, DNS,
retained-session recovery, or authenticated telemetry. Never load a live .env.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "smart-factory-backend"
NAMES = (".env.prod.example", ".env.prod.api.example", ".env.prod.worker.example")


def read_example(name: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate((BACKEND / name).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key or key in values:
            raise AssertionError(f"{name}:{number}: malformed or duplicate setting")
        values[key] = value
    return values


class ProductionEnvironmentExamplesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.examples = {name: read_example(name) for name in NAMES}

    def test_canonical_frontend_and_password_recovery_origins(self) -> None:
        for name, values in self.examples.items():
            with self.subTest(example=name, setting="PASSWORD_RESET_ORIGIN"):
                self.assertEqual(values.get("PASSWORD_RESET_ORIGIN"), "https://factory.onesa.eu")
            if name != ".env.prod.worker.example":
                with self.subTest(example=name, setting="ALLOWED_ORIGIN"):
                    self.assertEqual(values.get("ALLOWED_ORIGIN"), "https://factory.onesa.eu")

    def test_destination_mqtt_hostname(self) -> None:
        for name, values in self.examples.items():
            with self.subTest(example=name):
                self.assertEqual(values.get("MqttBrokerHost"), "factory-mqtt.onesa.eu")

    def test_worker_uses_canonical_api_origin(self) -> None:
        self.assertEqual(
            self.examples[".env.prod.worker.example"].get("DASHBOARD_API_ORIGIN"),
            "https://factory-api.onesa.eu",
        )

    def test_mqtt_transport_remains_tls(self) -> None:
        for name, values in self.examples.items():
            with self.subTest(example=name):
                self.assertEqual(values.get("MqttBrokerPort"), "8883")
                self.assertEqual(values.get("MqttUseTls"), "true")

    def test_existing_example_client_ids_and_topics_are_preserved(self) -> None:
        expected_ids = {
            ".env.prod.example": "smart-factory-telemetry-production",
            ".env.prod.worker.example": "smart-factory-production-worker-01",
        }
        for name, client_id in expected_ids.items():
            values = self.examples[name]
            with self.subTest(example=name):
                self.assertEqual(values.get("MqttClientId"), client_id)
                self.assertEqual(values.get("MqttTopic"), "factory/+/+/+/telemetry")
                self.assertEqual(values.get("MqttHeartbeatTopic"), "factory/+/+/+/heartbeat")

    def test_mqtt_credentials_remain_placeholders(self) -> None:
        for name, values in self.examples.items():
            for key in ("MqttUsername", "MqttPassword"):
                with self.subTest(example=name, setting=key):
                    value = values.get(key, "")
                    self.assertTrue(
                        value.startswith("CHANGE_ME_") or (value.startswith("<") and value.endswith(">")),
                        f"{name}: {key} must remain a non-secret example placeholder",
                    )

    def test_production_mode_and_existing_role_contract_are_preserved(self) -> None:
        for name, values in self.examples.items():
            with self.subTest(example=name):
                self.assertEqual(values.get("ASPNETCORE_ENVIRONMENT"), "Production")
        self.assertEqual(self.examples[".env.prod.api.example"].get("RENDER_SERVICE_ROLE"), "web")
        self.assertEqual(self.examples[".env.prod.worker.example"].get("RENDER_SERVICE_ROLE"), "worker")

    def test_application_email_identity_is_preserved(self) -> None:
        for name, values in self.examples.items():
            with self.subTest(example=name):
                self.assertEqual(values.get("EMAIL_PROVIDER"), "resend")
                self.assertEqual(values.get("RESEND_FROM"), "Smart Factory <notifications-factory@onesa.eu>")
                self.assertEqual(values.get("RESEND_ALLOWED_RECIPIENT_DOMAINS"), "onesa.eu")

    def test_basyx_authentication_is_not_relaxed(self) -> None:
        for name in (".env.prod.example", ".env.prod.api.example"):
            with self.subTest(example=name):
                self.assertEqual(self.examples[name].get("AAS_ALLOW_UNAUTHENTICATED_LOCAL"), "false")
                self.assertEqual(self.examples[name].get("AAS_ALLOW_UNAUTHENTICATED_PRIVATE"), "false")


if __name__ == "__main__":
    unittest.main()
