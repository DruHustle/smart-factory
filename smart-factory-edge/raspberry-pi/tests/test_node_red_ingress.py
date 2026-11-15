import json
import os
import sys
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from config import load_settings
from sensor_gateway import forward_local_message, forward_local_control_ack, validate_gpio_command, telemetry_topic, heartbeat_topic, encoded_topic


class NodeRedTrustBoundaryTests(unittest.TestCase):
    def settings(self, approved=()):
        return types.SimpleNamespace(
            device_id="pi-edge-01", site_id="fixture", line_id="line",
            local_mqtt_device_ids=("node-red-source-01",),
            node_red_source_ids=("node-red-source-01",),
            node_red_approved_live_ids=approved
        )

    def publish(self, payload, approved=(), retained=False):
        captured = []
        sender = types.SimpleNamespace(
            publish=lambda topic, encoded, **kwargs:
                captured.append(json.loads(encoded)) or types.SimpleNamespace(rc=0)
        )
        message = types.SimpleNamespace(
            topic=telemetry_topic("fixture", "line", "node-red-source-01"),
            payload=json.dumps(payload).encode(),
            retain=retained,
        )
        accepted = forward_local_message(self.settings(approved), sender, message)
        return accepted, captured

    def publish_raw(self, payload, approved=(), retained=False):
        captured = []
        sender = types.SimpleNamespace(
            publish=lambda topic, encoded, **kwargs:
                captured.append(json.loads(encoded)) or types.SimpleNamespace(rc=0)
        )
        message = types.SimpleNamespace(
            topic=telemetry_topic("fixture", "line", "node-red-source-01"),
            payload=payload,
            retain=retained,
        )
        accepted = forward_local_message(self.settings(approved), sender, message)
        return accepted, captured

    def test_node_red_requires_separate_explicit_source_allowlist(self):
        base = {"LOCAL_MQTT_ENABLED": "true", "LOCAL_MQTT_DEVICE_IDS": "node-red-source-01",
                "NODE_RED_SOURCE_IDS": "node-red-source-01"}
        with patch.dict(os.environ, base, clear=True):
            self.assertEqual(load_settings().node_red_source_ids, ("node-red-source-01",))
        for invalid in [
            {"NODE_RED_SOURCE_IDS": "unknown"},
            {"NODE_RED_APPROVED_LIVE_IDS": "unknown"},
            {"NODE_RED_SOURCE_IDS": "node-red-source-01",
             "LOCAL_MQTT_CONTROL_DEVICE_IDS": "node-red-source-01"},
        ]:
            with patch.dict(os.environ, {**base, **invalid}, clear=True):
                with self.assertRaises(RuntimeError):
                    load_settings()

    def test_uncommissioned_reading_is_historical_not_good_live(self):
        payload = {
            "deviceId": "node-red-source-01", "timestamp": 1793066400000,
            "temperature": 23.5
        }
        accepted, records = self.publish(payload)
        self.assertTrue(accepted)
        self.assertEqual(records[0]["integration"]["sourceQuality"], "bad")
        self.assertEqual(records[0]["integration"]["mode"], "live")
        self.assertEqual(records[0]["gatewayId"], "pi-edge-01")

    def test_node_red_cannot_inject_provenance_or_commands(self):
        payload = {
            "deviceId": "node-red-source-01", "timestamp": 1793066400000,
            "temperature": 23.5,
            "integration": {"mode": "live", "sourceQuality": "good"}
        }
        self.assertFalse(self.publish(payload)[0])
        payload.pop("integration")
        payload["observation"] = {
            "schemaVersion": 1, "mode": "live", "sourceQuality": "good",
            "sessionId": "node-red", "sequence": 1
        }
        self.assertFalse(self.publish(payload)[0])
        payload.pop("observation")
        payload["action"] = "start_motor"
        self.assertFalse(self.publish(payload)[0])

    def test_duplicate_json_keys_are_rejected_at_every_telemetry_nesting_level(self):
        # Different JSON parsers can choose different values for duplicate
        # keys. Identity, timestamps and nested signal maps must be unambiguous.
        payloads = (
            b'{"deviceId":"attacker","deviceId":"node-red-source-01","timestamp":1793066400000,"temperature":23.5}',
            b'{"deviceId":"node-red-source-01","timestamp":1,"timestamp":1793066400000,"temperature":23.5}',
            b'{"deviceId":"node-red-source-01","timestamp":1793066400000,"assetSignals":{"pressure":1,"pressure":2}}',
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                accepted, messages = self.publish_raw(payload)
                self.assertFalse(accepted)
                self.assertEqual(messages, [])

    def test_untrusted_status_and_provenance_types_fail_closed(self):
        # MQTT/Node-RED JSON is untrusted: arrays and objects must be rejected
        # rather than raising TypeError from set membership in the callback.
        for invalid in ([], {}, None, False, 1.5):
            with self.subTest(value=invalid):
                heartbeat = types.SimpleNamespace(
                    topic=heartbeat_topic("fixture", "line", "node-red-source-01"),
                    payload=json.dumps({
                        "deviceId": "node-red-source-01",
                        "timestamp": 1793066400000, "status": invalid
                    }).encode(), retain=False,
                )
                self.assertFalse(forward_local_message(self.settings(), None, heartbeat))
                accepted, messages = self.publish({
                    "deviceId": "node-red-source-01",
                    "timestamp": 1793066400000,
                    "sensorStatus": invalid,
                })
                self.assertFalse(accepted)
                self.assertEqual(messages, [])
                accepted, messages = self.publish({
                    "deviceId": "node-red-source-01",
                    "timestamp": 1793066400000,
                    "observation": {
                        "schemaVersion": 1, "mode": "live",
                        "sourceQuality": invalid,
                        "sessionId": "node-red", "sequence": 1,
                    },
                })
                self.assertFalse(accepted)
                self.assertEqual(messages, [])

    def test_ingress_enforces_backend_metric_and_named_signal_bounds(self):
        invalid_records = (
            {"temperature": 1_000_000_001},
            {"vibration": -1_000_000_001},
            {"power": 1e300},
            {"pressure": -1e300},
            {"rpm": 1_000_000_001},
            {"humidity": 100.1},
            {"assetSignals": {"counter": 4_294_967_296}},
            {"assetSignals": {"counter": 10 ** 500}},
        )
        for invalid_fields in invalid_records:
            with self.subTest(fields=invalid_fields):
                accepted, messages = self.publish({
                    "deviceId": "node-red-source-01",
                    "timestamp": 1793066400000,
                    **invalid_fields,
                })
                self.assertFalse(accepted)
                self.assertEqual(messages, [])

    def test_untrusted_engineering_mapping_unit_type_is_rejected(self):
        for invalid in ([], {}, None, False, 5):
            with self.subTest(raw_unit=invalid):
                accepted, messages = self.publish({
                    "deviceId": "node-red-source-01",
                    "timestamp": 1793066400000,
                    "pressure": 3.0,
                    "units": {"pressure": "bar"},
                    "mapping": {"pressure": {
                        "rawValue": 3.0,
                        "rawUnit": invalid,
                        "scale": 1.0,
                        "offset": 0.0,
                        "version": "sf-mapping-v1",
                    }},
                })
                self.assertFalse(accepted)
                self.assertEqual(messages, [])

    def test_oversized_mapping_integer_is_rejected_without_gateway_restart(self):
        # A bounded MQTT packet can contain a large JSON integer that makes
        # math.isfinite(int) raise OverflowError if bounds are checked last.
        accepted, messages = self.publish({
            "deviceId": "node-red-source-01",
            "timestamp": 1793066400000,
            "pressure": 3.0,
            "units": {"pressure": "bar"},
            "mapping": {"pressure": {
                "rawValue": 10 ** 500,
                "rawUnit": "register",
                "scale": 1.0,
                "offset": 0.0,
                "version": "sf-mapping-v1",
            }},
        })
        self.assertFalse(accepted)
        self.assertEqual(messages, [])

    def test_untrusted_control_ack_status_is_rejected_without_gateway_restart(self):
        settings = self.settings()
        settings.local_mqtt_control_device_ids = ("wrover-01",)
        topic = encoded_topic("fixture", "line", "wrover-01", "control-ack")
        base_ack = {
            "deviceId": "wrover-01",
            "commandId": "command-123",
            "timestamp": 1793066400000,
            "status": "applied",
        }
        forwarded = []
        cloud = types.SimpleNamespace(publish=lambda *args, **kwargs:
            forwarded.append((args, kwargs)) or types.SimpleNamespace(rc=0))
        for invalid in ([], {}, None, False, 1.5):
            with self.subTest(status=invalid):
                msg = types.SimpleNamespace(
                    topic=topic,
                    payload=json.dumps({**base_ack, "status": invalid}).encode(),
                    retain=False,
                )
                self.assertFalse(forward_local_control_ack(settings, cloud, msg))
                self.assertEqual(forwarded, [])
        valid = types.SimpleNamespace(
            topic=topic, payload=json.dumps(base_ack).encode(), retain=False,
        )
        self.assertFalse(forward_local_control_ack(settings, cloud, valid))
        self.assertTrue(forward_local_control_ack(settings, cloud, valid, transport_verified=True))
        self.assertEqual(len(forwarded), 1)

    def test_control_ack_requires_verified_nonretained_broker_and_exact_firmware_shape(self):
        settings = self.settings()
        settings.local_mqtt_control_device_ids = ("wrover-01",)
        topic = encoded_topic("fixture", "line", "wrover-01", "control-ack")
        base = {
            "deviceId": "wrover-01", "commandId": "command-123",
            "timestamp": 1793066400000, "status": "applied",
            "pin": 18, "value": 1,
        }
        published = []
        cloud = types.SimpleNamespace(publish=lambda *a, **kw:
            published.append(a) or types.SimpleNamespace(rc=0))
        def message(record, retained=False):
            return types.SimpleNamespace(
                topic=topic, payload=json.dumps(record).encode(), retain=retained
            )
        self.assertFalse(forward_local_control_ack(settings, cloud, message(base)))
        self.assertFalse(forward_local_control_ack(settings, cloud, message(base, retained=True),
                                                   transport_verified=True))
        for fields in (
            {"action": "set_gpio"}, {"action": ["configure_mqtt_qos"]},
            {"value": True}, {"value": 2}, {"pin": True}, {"pin": 19},
            {"reason": {}}, {"reason": "x" * 129}, {"extra": "spoof"},
        ):
            with self.subTest(fields=fields):
                self.assertFalse(forward_local_control_ack(
                    settings, cloud, message({**base, **fields}), transport_verified=True
                ))
        duplicate = json.dumps(base)[:-1] + ', "status": "rejected"}'
        self.assertFalse(forward_local_control_ack(
            settings, cloud,
            types.SimpleNamespace(topic=topic, payload=duplicate.encode(), retain=False),
            transport_verified=True,
        ))
        self.assertEqual(published, [])
        self.assertTrue(forward_local_control_ack(
            settings, cloud, message(base), transport_verified=True
        ))
        self.assertEqual(len(published), 1)

    def test_boolean_schema_cannot_authorize_gpio_relay(self):
        settings = self.settings()
        settings.local_mqtt_control_device_ids = ("wrover-01",)
        settings.local_mqtt_device_ids = ("wrover-01",)
        command = {
            "schemaVersion": 1,
            "action": "set_gpio",
            "commandId": "command-123",
            "targetDeviceId": "wrover-01",
            "pin": 18,
            "value": 1,
            "holdMs": 100,
            "expiresAt": int(time.time() * 1000) + 10000,
        }
        self.assertEqual(validate_gpio_command(settings, command)["pin"], 18)
        with self.assertRaises(ValueError):
            validate_gpio_command(settings, {**command, "schemaVersion": True})

    def test_explicitly_commissioned_source_still_preserves_broker_retention(self):
        payload = {
            "deviceId": "node-red-source-01", "timestamp": 1793066400000,
            "assetId": "urn:fixture:pump", "assetSignals": {"pressure": 3.2}
        }
        accepted, records = self.publish(
            payload, approved=("node-red-source-01",), retained=True
        )
        self.assertTrue(accepted)
        self.assertEqual(records[0]["integration"]["sourceQuality"], "good")
        self.assertTrue(records[0]["integration"]["retained"])
        self.assertTrue(records[0]["transportRetained"])


if __name__ == "__main__":
    unittest.main()
