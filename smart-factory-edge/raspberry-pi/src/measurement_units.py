"""Independent wire identity, units and reviewed scaling contract (version 1)."""
import math
import re

WIRE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}", re.ASCII)
MAX_RAW_MAPPING_VALUE = 9007199254740991
MAX_MAPPING_FACTOR = 1e9
MAX_MAPPED_VALUE = 1e9

SOURCE_UNITS = {
    "temperature": {"Cel", "°C", "C", "°F", "F", "K"},
    "humidity": {"%", "fraction"},
    "vibration": {"mm/s", "m/s"},
    "power": {"W", "kW", "MW"},
    "pressure": {"Pa", "kPa", "MPa", "bar"},
    "rpm": {"rpm", "r/min", "1/min", "Hz"},
}


def valid_identity(value):
    return isinstance(value, str) and WIRE_ID.fullmatch(value) is not None


def finite_number(value, max_abs=None):
    """Check JSON numeric inputs without overflowing on arbitrarily large ints."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return max_abs is None or abs(value) <= max_abs
    try:
        number = float(value)
    except (OverflowError, TypeError, ValueError):
        return False
    return math.isfinite(number) and (max_abs is None or abs(number) <= max_abs)


def valid_units(units):
    return (
        isinstance(units, dict)
        and len(units) <= 6
        and all(
            key in SOURCE_UNITS and isinstance(unit, str) and unit in SOURCE_UNITS[key]
            for key, unit in units.items()
        )
    )


def mapped_value(output, metric, raw, mapping, raw_unit="native"):
    if not finite_number(raw, MAX_RAW_MAPPING_VALUE):
        raise ValueError("Mapped source value must be a bounded finite number")
    raw_scale = mapping.get("scale", 1)
    raw_offset = mapping.get("offset", 0)
    if not finite_number(raw_scale, MAX_MAPPING_FACTOR) or not finite_number(raw_offset, MAX_MAPPING_FACTOR):
        raise ValueError("Engineering scale and offset must be bounded finite numbers")
    scale = float(raw_scale)
    offset = float(raw_offset)
    value = float(raw) * scale + offset
    if not math.isfinite(value) or abs(value) > MAX_MAPPED_VALUE:
        raise ValueError("Mapped value is out of range")
    output[metric] = value
    unit = mapping.get("unit")
    if unit:
        if not isinstance(unit, str) or metric not in SOURCE_UNITS or unit not in SOURCE_UNITS[metric]:
            raise ValueError("Unsupported engineering unit for metric")
        output.setdefault("units", {})[metric] = unit
        output.setdefault("mapping", {})[metric] = {
            "rawValue": float(raw),
            "rawUnit": raw_unit,
            "scale": scale,
            "offset": offset,
            "version": "sf-mapping-v1",
        }


def valid_mapping(mapping, units, values):
    if not isinstance(mapping, dict) or len(mapping) > 6 or not valid_units(units):
        return False
    for metric, item in mapping.items():
        if metric not in units or metric not in values or not isinstance(item, dict):
            return False
        if set(item) != {"rawValue", "rawUnit", "scale", "offset", "version"}:
            return False
        if not isinstance(item["rawUnit"], str) or item["rawUnit"] not in {"register", "native"}:
            return False
        if item["version"] != "sf-mapping-v1":
            return False
        if not finite_number(item["rawValue"], MAX_RAW_MAPPING_VALUE):
            return False
        if not finite_number(item["scale"], MAX_MAPPING_FACTOR):
            return False
        if not finite_number(item["offset"], MAX_MAPPING_FACTOR):
            return False
        value = values[metric]
        if not finite_number(value):
            return False
        expected = float(item["rawValue"]) * float(item["scale"]) + float(item["offset"])
        actual = float(value)
        if not math.isfinite(expected) or abs(expected - actual) > max(1e-6, abs(actual) * 1e-9):
            return False
    return True
