import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from config import _as_bool, load_settings


class BooleanEnvironmentTests(unittest.TestCase):
    def test_explicit_boolean_values_and_defaults(self):
        self.assertTrue(_as_bool(None, True))
        self.assertFalse(_as_bool(None, False))
        for value in ("1", "true", "YES", " on "):
            with self.subTest(value=value):
                self.assertTrue(_as_bool(value))
        for value in ("0", "false", "NO", " off "):
            with self.subTest(value=value):
                self.assertFalse(_as_bool(value, True))

    def test_invalid_boolean_values_are_rejected(self):
        for value in ("tru", "enabled", "2", "", "perhaps"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, "Boolean environment"):
                    _as_bool(value, True)

    def test_invalid_environment_flags_fail_gateway_configuration(self):
        names = (
            "MQTT_USE_TLS",
            "LOCAL_MQTT_ENABLED",
            "LOCAL_MQTT_USE_TLS",
            "TELEMETRY_COALESCING_ENABLED",
            "SERIAL_ENABLED",
            "SYNTHETIC_TELEMETRY_ENABLED",
        )
        for name in names:
            with self.subTest(name=name):
                with patch.dict(os.environ, {name: "treu"}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, "Boolean environment"):
                        load_settings()

    def test_explicit_false_values_remain_supported_in_isolated_development(self):
        values = {
            "MQTT_USE_TLS": "false",
            "LOCAL_MQTT_ENABLED": "no",
            "LOCAL_MQTT_USE_TLS": "off",
            "TELEMETRY_COALESCING_ENABLED": "0",
            "SERIAL_ENABLED": "false",
            "SYNTHETIC_TELEMETRY_ENABLED": "no",
        }
        with patch.dict(os.environ, values, clear=True):
            settings = load_settings()
        self.assertFalse(settings.mqtt_use_tls)
        self.assertFalse(settings.local_mqtt_enabled)
        self.assertFalse(settings.local_mqtt_use_tls)
        self.assertFalse(settings.telemetry_coalescing_enabled)
        self.assertFalse(settings.serial_enabled)
        self.assertFalse(settings.synthetic_telemetry_enabled)


if __name__ == "__main__":
    unittest.main()
