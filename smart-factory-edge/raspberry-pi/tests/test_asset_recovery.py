"""Regression coverage for legacy asset transport recovery and typed reads."""
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from asset_adapters import SerialJsonConnectionManager, _decode_registers, _read_modbus_mappings, _serial_record_values, validate_asset_profile
from measurement_units import mapped_value


class AssetRecoveryTests(unittest.TestCase):
    def test_disconnected_serial_descriptor_reopens_on_next_poll(self):
        closed, limits = [], []
        def failed_read(size):
            limits.append(size)
            raise OSError("USB disconnected")
        failed = types.SimpleNamespace(readline=failed_read, close=lambda: closed.append("failed"))
        recovered = types.SimpleNamespace(readline=lambda size: limits.append(size) or b'{"pressure":12.5}\n', close=lambda: closed.append("recovered"))
        with patch.dict(sys.modules, {"serial": types.SimpleNamespace(Serial=unittest.mock.Mock(side_effect=[failed, recovered]))}):
            manager = SerialJsonConnectionManager()
            endpoint = "serial:///dev/serial/by-id/fixture?settle=0"
            with self.assertRaisesRegex(OSError, "disconnected"):
                manager.read_record("fixture", endpoint)
            self.assertEqual(manager.read_record("fixture", endpoint), {"pressure": 12.5})
            manager.close()
        self.assertEqual(closed, ["failed", "recovered"])
        self.assertEqual(limits, [4097, 4097])

    def test_oversized_serial_record_is_bounded_before_parsing(self):
        port = types.SimpleNamespace(readline=lambda size: b"x" * size, close=lambda: None)
        with patch.dict(sys.modules, {"serial": types.SimpleNamespace(Serial=lambda *a, **kw: port)}):
            manager = SerialJsonConnectionManager()
            with self.assertRaisesRegex(ValueError, "supported size"):
                manager.read_record("fixture", "serial:///dev/fixture?settle=0")
            manager.close()

    def test_invalid_modbus_profiles_are_rejected_before_persistence(self):
        for fields in ({"dataType": "float32"}, {"dataType": "int16", "count": 2}, {"dataType": "typo"},
                       {"wordOrder": "typo"}, {"registerType": "coil"}, {"unitId": True},
                       {"unitId": 256}, {"unitId": 1, "deviceId": 2}, {"address": 65535, "count": 2}):
            mapping = {"metric": "pressure", "address": 0, **fields}
            profile = {"schemaVersion": 1, "gatewayDeviceId": "pi-edge-01", "assets": [
                {"assetId": "fixture", "protocol": "modbus_tcp", "endpoint": "tcp://127.0.0.1:1502", "tagMappings": [mapping]}]}
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                validate_asset_profile(profile, "pi-edge-01")

    def test_asset_mapping_rejects_overflowing_and_unhashable_configuration(self):
        for field, value in (
            ("scale", 10 ** 500),
            ("offset", 10 ** 500),
            ("scale", 1e300),
            ("unit", {}),
            ("unit", []),
        ):
            mapping = {"metric": "pressure", "address": 0, field: value}
            profile = {"schemaVersion": 1, "gatewayDeviceId": "pi-edge-01", "assets": [
                {"assetId": "fixture", "protocol": "modbus_tcp", "endpoint": "tcp://127.0.0.1:1502", "tagMappings": [mapping]}]}
            with self.subTest(field=field, value=repr(value)), self.assertRaises(ValueError):
                validate_asset_profile(profile, "pi-edge-01")

    def test_raw_and_serial_numeric_overflow_fails_as_validation_not_overflow_error(self):
        for raw in (10 ** 500, float("inf"), float("nan"), True):
            with self.subTest(raw=repr(raw)), self.assertRaises(ValueError):
                mapped_value({}, "pressure", raw, {"scale": 1.0, "offset": 0.0}, "native")
            with self.subTest(serial_raw=repr(raw)), self.assertRaises(ValueError):
                _serial_record_values({"pressure": raw}, [{"metric": "pressure", "source": "pressure"}])

        with self.assertRaises(ValueError):
            _serial_record_values({"signals": {"counter": 10 ** 500}}, [])

    def test_bounded_engineering_mapping_still_converts_valid_values(self):
        output = {}
        mapped_value(output, "pressure", 742, {"scale": 0.01, "offset": 0.25, "unit": "bar"}, "register")
        self.assertEqual(output["pressure"], 7.67)
        self.assertEqual(output["units"]["pressure"], "bar")
        self.assertEqual(output["mapping"]["pressure"]["rawValue"], 742.0)

    def test_modbus_width_sign_and_word_order_preserve_values(self):
        self.assertEqual(_decode_registers([65535], {"dataType": "INT16"}), -1)
        self.assertEqual(_decode_registers([0, 0x4148], {"dataType": "float32", "count": 2, "wordOrder": "little"}), 12.5)
        for words, mapping in (([0x4148], {"dataType": "float32", "count": 2}), ([65536], {}), ([True], {})):
            with self.subTest(words=words), self.assertRaises(ValueError):
                _decode_registers(words, mapping)

    def test_short_modbus_response_never_becomes_a_valid_measurement(self):
        response = types.SimpleNamespace(isError=lambda: False, registers=[0x4148])
        client = types.SimpleNamespace(read_holding_registers=lambda *a, **kw: response)
        with self.assertRaisesRegex(ValueError, "incomplete registers"):
            _read_modbus_mappings(client, [{"metric": "pressure", "address": 0, "dataType": "float32", "count": 2}])


if __name__ == "__main__":
    unittest.main()
