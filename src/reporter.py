"""Rich terminal output for price comparison results."""

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich import box

console = Console()


def _fmt_gbp(value: float) -> str:
    return f"£{value:,.2f}"


def _fmt_pence(value: float) -> str:
    return f"{value:.2f}p"


def print_banner() -> None:
    console.print(
        Panel(
            "[bold cyan]Energy Price Comparator[/bold cyan]\n"
            "[dim]Apples-to-apples comparison using your actual usage[/dim]",
            border_style="cyan",
            expand=False,
        )
    )


def print_current_tariff(current: dict, config: dict) -> None:
    elec = config.get("electricity", {})
    gas = config.get("gas", {})

    table = Table(title="Your Current Tariff", box=box.ROUNDED, show_header=True)
    table.add_column("", style="bold")
    table.add_column("Electricity", justify="right")
    table.add_column("Gas", justify="right")

    table.add_row(
        "Supplier",
        elec.get("supplier", "—"),
        gas.get("supplier", "—"),
    )
    table.add_row(
        "Tariff",
        elec.get("tariff_name", "—"),
        gas.get("tariff_name", "—"),
    )
    table.add_row(
        "Unit rate",
        _fmt_pence(elec.get("unit_rate_pence", 0)),
        _fmt_pence(gas.get("unit_rate_pence", 0)),
    )
    table.add_row(
        "Standing charge",
        _fmt_pence(elec.get("standing_charge_pence", 0)) + "/day",
        _fmt_pence(gas.get("standing_charge_pence", 0)) + "/day",
    )
    table.add_row(
        "Annual usage",
        f"{elec.get('annual_usage_kwh', 0):,} kWh",
        f"{gas.get('annual_usage_kwh', 0):,} kWh",
    )
    table.add_row(
        "Annual cost",
        _fmt_gbp(current["electricity_annual_gbp"]),
        _fmt_gbp(current["gas_annual_gbp"]),
    )

    console.print(table)
    console.print(
        f"  [bold]Total annual cost:[/bold] [yellow]{_fmt_gbp(current['total_annual_gbp'])}[/yellow]"
    )
    console.print()


def print_comparison_table(current: dict, results: list[dict], top_n: int = 10) -> None:
    table = Table(
        title=f"Best Deals on the Market  (top {min(top_n, len(results))})",
        box=box.SIMPLE_HEAD,
        show_header=True,
        header_style="bold magenta",
    )
    table.add_column("#", justify="right", style="dim", width=3)
    table.add_column("Supplier", min_width=20)
    table.add_column("Tariff", min_width=18)
    table.add_column("Type", width=8)
    table.add_column("Green", width=5, justify="center")
    table.add_column("Elec p/kWh", justify="right")
    table.add_column("Gas p/kWh", justify="right")
    table.add_column("Annual Cost", justify="right", style="bold")
    table.add_column("Saving", justify="right")
    table.add_column("Exit Fee", justify="right", width=8)

    for i, r in enumerate(results[:top_n], 1):
        saving = r["saving_gbp"]
        if saving > 0:
            saving_str = f"[green]+{_fmt_gbp(saving)}[/green]"
        elif saving < 0:
            saving_str = f"[red]{_fmt_gbp(saving)}[/red]"
        else:
            saving_str = "[dim]—[/dim]"

        green_str = "[green]YES[/green]" if r.get("green") else "[dim]no[/dim]"
        exit_str = _fmt_gbp(r["exit_fee_gbp"]) if r["exit_fee_gbp"] > 0 else "[dim]none[/dim]"

        # Highlight cheapest
        row_style = "bold" if i == 1 else ""

        table.add_row(
            str(i),
            r["supplier"],
            r["tariff_name"],
            r.get("type", "var")[:5],
            green_str,
            _fmt_pence(r["electricity_unit_rate"]),
            _fmt_pence(r["gas_unit_rate"]),
            _fmt_gbp(r["total_annual_gbp"]),
            saving_str,
            exit_str,
            style=row_style,
        )

    console.print(table)


def print_top_deal(current: dict, results: list[dict]) -> None:
    if not results:
        return
    best = results[0]
    saving = best["saving_gbp"]

    if saving <= 0:
        console.print(
            Panel(
                "[yellow]You're already on one of the best available deals![/yellow]\n"
                "Check back when your fix period ends or Ofgem updates the price cap.",
                border_style="yellow",
                title="Verdict",
            )
        )
        return

    pct = best["saving_pct"]
    console.print(
        Panel(
            f"Switch to [bold cyan]{best['supplier']} — {best['tariff_name']}[/bold cyan]\n"
            f"and save [bold green]{_fmt_gbp(saving)} per year ({pct}%)[/bold green]\n\n"
            f"Switch link: [link={best['switch_url']}]{best['switch_url']}[/link]\n\n"
            f"[dim]{best['notes']}[/dim]",
            border_style="green",
            title="Best Deal Found",
        )
    )


def print_switching_guide(result: dict) -> None:
    console.print()
    console.print(Panel(
        f"[bold]How to switch to {result['supplier']}[/bold]\n\n"
        "1. Visit: [cyan]{url}[/cyan]\n"
        "2. Enter your postcode and usage figures (from your bill).\n"
        "3. Select this tariff — your new supplier handles the switch.\n"
        "4. [green]You do NOT need to contact your old supplier.[/green]\n"
        "5. Switching usually takes 5–10 working days.\n"
        "6. By law you can switch at any time with no interruption to supply.\n"
        "7. You have a 14-day cooling-off period after switching.\n\n"
        "[dim]Keep your old bills until the final statement arrives from your old supplier.[/dim]".format(
            url=result["switch_url"]
        ),
        border_style="cyan",
        title="Switching Guide",
    ))
