"""Interactive setup wizard to capture the user's current energy tariff."""

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, FloatPrompt, IntPrompt, Confirm

console = Console()

UK_AVERAGE_ELEC_KWH = 3100
UK_AVERAGE_GAS_KWH = 12000


def _ask_float(prompt: str, default: float, unit: str = "") -> float:
    label = f"{prompt} [{default}{unit}]"
    while True:
        raw = Prompt.ask(label, default=str(default))
        try:
            return float(raw)
        except ValueError:
            console.print("[red]Please enter a number.[/red]")


def _ask_int(prompt: str, default: int, unit: str = "") -> int:
    label = f"{prompt} [{default}{unit}]"
    while True:
        raw = Prompt.ask(label, default=str(default))
        try:
            return int(raw)
        except ValueError:
            console.print("[red]Please enter a whole number.[/red]")


def run_setup_wizard(existing_config: dict) -> dict:
    """Walk the user through entering their current tariff details."""

    console.print(Panel(
        "Let's set up your current energy tariff so we can compare it against\n"
        "the market.  You'll find all these figures on your latest energy bill\n"
        "or in your online account.\n\n"
        "[dim]Press Enter to keep the value shown in brackets.[/dim]",
        title="Setup Wizard",
        border_style="cyan",
    ))

    config = dict(existing_config)

    # ------------------------------------------------------------------ postcode
    config["postcode"] = Prompt.ask(
        "Your postcode (optional — used for regional pricing)",
        default=config.get("postcode", ""),
    )

    # ---------------------------------------------------------------- fuel types
    has_electricity = Confirm.ask("Do you pay for [bold]electricity[/bold]?", default=True)
    has_gas = Confirm.ask("Do you pay for [bold]gas[/bold]?", default=True)

    if not has_electricity and not has_gas:
        console.print("[yellow]Nothing to compare — please run again and select at least one fuel.[/yellow]")
        return config

    # ------------------------------------------------------------ electricity
    if has_electricity:
        console.print("\n[bold cyan]--- Electricity ---[/bold cyan]")
        elec = dict(config.get("electricity", {}))

        elec["supplier"] = Prompt.ask(
            "Current electricity supplier",
            default=elec.get("supplier", "Unknown"),
        )
        elec["tariff_name"] = Prompt.ask(
            "Tariff name (e.g. 'Standard Variable')",
            default=elec.get("tariff_name", "Standard Variable"),
        )
        elec["unit_rate_pence"] = _ask_float(
            "Unit rate (pence per kWh)",
            default=elec.get("unit_rate_pence", 24.50),
            unit="p/kWh",
        )
        elec["standing_charge_pence"] = _ask_float(
            "Standing charge (pence per day)",
            default=elec.get("standing_charge_pence", 61.64),
            unit="p/day",
        )
        elec["annual_usage_kwh"] = _ask_int(
            "Annual usage (kWh) — from bill or estimate",
            default=elec.get("annual_usage_kwh", UK_AVERAGE_ELEC_KWH),
            unit=" kWh",
        )

        config["electricity"] = elec
    else:
        config["electricity"] = {"unit_rate_pence": 0.0, "standing_charge_pence": 0.0, "annual_usage_kwh": 0}

    # -------------------------------------------------------------------- gas
    if has_gas:
        console.print("\n[bold cyan]--- Gas ---[/bold cyan]")
        gas = dict(config.get("gas", {}))

        gas["supplier"] = Prompt.ask(
            "Current gas supplier",
            default=gas.get("supplier", "Unknown"),
        )
        gas["tariff_name"] = Prompt.ask(
            "Tariff name",
            default=gas.get("tariff_name", "Standard Variable"),
        )
        gas["unit_rate_pence"] = _ask_float(
            "Unit rate (pence per kWh)",
            default=gas.get("unit_rate_pence", 6.24),
            unit="p/kWh",
        )
        gas["standing_charge_pence"] = _ask_float(
            "Standing charge (pence per day)",
            default=gas.get("standing_charge_pence", 31.65),
            unit="p/day",
        )
        gas["annual_usage_kwh"] = _ask_int(
            "Annual usage (kWh) — from bill or estimate",
            default=gas.get("annual_usage_kwh", UK_AVERAGE_GAS_KWH),
            unit=" kWh",
        )

        config["gas"] = gas
    else:
        config["gas"] = {"unit_rate_pence": 0.0, "standing_charge_pence": 0.0, "annual_usage_kwh": 0}

    console.print()
    return config
