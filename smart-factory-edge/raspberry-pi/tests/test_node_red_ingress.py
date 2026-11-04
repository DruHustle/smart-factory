import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from config import load_settings
from sensor_gateway import forward_local_message, telemetry_topic


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

    def test_node_red_requires_separate_explicit_source_allowlist(self):
        base = {"LOCAL_MQTT_ENABLED": "true", "LOCAL_MQTT_DEVICE_IDS": "node-red-source-01",
                "NODE_RED_SOURCE_IDS": "node-red-source-01"}
        with patch.dict(os.environ, base, clear=True):
            self.assertEqual(load_settings().node_red_source_ids, ("node-red-source-01",))
        for invalid in [
            {"NODE_RED_SOURCE_IDS": "unknown"},
            {"NODE_RED_APPROVED_LIVE_IDS": "node-red-source-01"},
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
