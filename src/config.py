"""User tariff configuration — stores and loads the user's current energy plan."""

import json
import os
from pathlib import Path

CONFIG_FILE = Path.home() / ".energy_comparator" / "config.json"

DEFAULT_CONFIG = {
    "region": "UK",
    "postcode": "",
    "electricity": {
        "supplier": "",
        "tariff_name": "",
        "unit_rate_pence": 0.0,       # p/kWh
        "standing_charge_pence": 0.0,  # p/day
        "annual_usage_kwh": 3100,      # UK average
        "payment_method": "direct_debit",
    },
    "gas": {
        "supplier": "",
        "tariff_name": "",
        "unit_rate_pence": 0.0,        # p/kWh
        "standing_charge_pence": 0.0,   # p/day
        "annual_usage_kwh": 12000,      # UK average
        "payment_method": "direct_debit",
    },
    "dual_fuel": False,
}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            stored = json.load(f)
        # Merge with defaults so new keys are always present
        config = {**DEFAULT_CONFIG}
        config.update(stored)
        return config
    return dict(DEFAULT_CONFIG)


def save_config(config: dict) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def has_current_tariff(config: dict) -> bool:
    elec = config.get("electricity", {})
    gas = config.get("gas", {})
    return (
        elec.get("unit_rate_pence", 0) > 0
        or gas.get("unit_rate_pence", 0) > 0
    )
