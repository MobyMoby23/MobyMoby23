"""Apples-to-apples price comparison using identical usage assumptions."""

DAYS_PER_YEAR = 365


def annual_cost_gbp(
    unit_rate_pence: float,
    standing_charge_pence: float,
    annual_usage_kwh: float,
) -> float:
    """Return annual cost in GBP for a single fuel."""
    unit_cost = unit_rate_pence * annual_usage_kwh
    standing_cost = standing_charge_pence * DAYS_PER_YEAR
    return (unit_cost + standing_cost) / 100


def tariff_annual_cost(
    tariff: dict,
    elec_usage_kwh: float,
    gas_usage_kwh: float,
    wants_electricity: bool = True,
    wants_gas: bool = True,
) -> dict:
    """Calculate the full annual cost for a tariff given usage figures.

    Returns a dict with per-fuel and total costs.
    """
    result: dict = {
        "supplier": tariff["supplier"],
        "tariff_name": tariff["tariff_name"],
        "type": tariff.get("type", "variable"),
        "green": tariff.get("green", False),
        "exit_fee_gbp": tariff.get("exit_fee_gbp", 0),
        "switch_url": tariff.get("switch_url", ""),
        "notes": tariff.get("notes", ""),
    }

    discount_pct = tariff.get("dual_fuel_discount_pct", 0)
    discount_factor = 1 - discount_pct / 100

    elec_annual = 0.0
    if wants_electricity and "electricity" in tariff:
        e = tariff["electricity"]
        elec_annual = annual_cost_gbp(
            e["unit_rate_pence"],
            e["standing_charge_pence"],
            elec_usage_kwh,
        )
        if wants_gas:
            elec_annual *= discount_factor

    gas_annual = 0.0
    if wants_gas and "gas" in tariff:
        g = tariff["gas"]
        gas_annual = annual_cost_gbp(
            g["unit_rate_pence"],
            g["standing_charge_pence"],
            gas_usage_kwh,
        )
        if wants_electricity:
            gas_annual *= discount_factor

    result["electricity_annual_gbp"] = round(elec_annual, 2)
    result["gas_annual_gbp"] = round(gas_annual, 2)
    result["total_annual_gbp"] = round(elec_annual + gas_annual, 2)
    result["electricity_unit_rate"] = tariff.get("electricity", {}).get("unit_rate_pence", 0)
    result["electricity_standing"] = tariff.get("electricity", {}).get("standing_charge_pence", 0)
    result["gas_unit_rate"] = tariff.get("gas", {}).get("unit_rate_pence", 0)
    result["gas_standing"] = tariff.get("gas", {}).get("standing_charge_pence", 0)
    result["dual_fuel_discount_pct"] = discount_pct

    return result


def current_annual_cost(config: dict) -> dict:
    """Calculate the user's current annual cost from their config."""
    elec = config.get("electricity", {})
    gas = config.get("gas", {})

    has_elec = elec.get("unit_rate_pence", 0) > 0
    has_gas = gas.get("unit_rate_pence", 0) > 0

    elec_cost = 0.0
    if has_elec:
        elec_cost = annual_cost_gbp(
            elec["unit_rate_pence"],
            elec.get("standing_charge_pence", 0),
            elec.get("annual_usage_kwh", 3100),
        )

    gas_cost = 0.0
    if has_gas:
        gas_cost = annual_cost_gbp(
            gas["unit_rate_pence"],
            gas.get("standing_charge_pence", 0),
            gas.get("annual_usage_kwh", 12000),
        )

    return {
        "supplier": elec.get("supplier") or gas.get("supplier") or "Current supplier",
        "tariff_name": elec.get("tariff_name") or gas.get("tariff_name") or "Current tariff",
        "electricity_annual_gbp": round(elec_cost, 2),
        "gas_annual_gbp": round(gas_cost, 2),
        "total_annual_gbp": round(elec_cost + gas_cost, 2),
        "electricity_unit_rate": elec.get("unit_rate_pence", 0),
        "electricity_standing": elec.get("standing_charge_pence", 0),
        "gas_unit_rate": gas.get("unit_rate_pence", 0),
        "gas_standing": gas.get("standing_charge_pence", 0),
    }


def compare_tariffs(
    market_tariffs: list[dict],
    config: dict,
) -> tuple[dict, list[dict]]:
    """Compare all market tariffs against the user's current plan.

    Returns (current_costs, ranked_market_results) sorted cheapest first.
    """
    elec_cfg = config.get("electricity", {})
    gas_cfg = config.get("gas", {})

    elec_kwh = elec_cfg.get("annual_usage_kwh", 3100)
    gas_kwh = gas_cfg.get("annual_usage_kwh", 12000)

    wants_elec = elec_cfg.get("unit_rate_pence", 0) > 0
    wants_gas = gas_cfg.get("unit_rate_pence", 0) > 0

    current = current_annual_cost(config)

    results = []
    for tariff in market_tariffs:
        result = tariff_annual_cost(
            tariff, elec_kwh, gas_kwh, wants_elec, wants_gas
        )
        result["saving_gbp"] = round(current["total_annual_gbp"] - result["total_annual_gbp"], 2)
        result["saving_pct"] = (
            round(result["saving_gbp"] / current["total_annual_gbp"] * 100, 1)
            if current["total_annual_gbp"] > 0 else 0.0
        )
        results.append(result)

    results.sort(key=lambda x: x["total_annual_gbp"])
    return current, results
