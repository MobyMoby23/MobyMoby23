#!/usr/bin/env python3
"""
Energy Price Comparator
-----------------------
Finds the cheapest electricity and gas deals on the market and compares
them apples-to-apples against your current tariff, then guides you through
switching suppliers.

Usage:
    python main.py            # compare prices (setup wizard on first run)
    python main.py --setup    # re-enter your tariff details
    python main.py --switch N # get switching guide for result #N
    python main.py --top N    # show top N results (default 10)
    python main.py --all      # show all available tariffs
    python main.py --verbose  # show data-fetching status
"""

import argparse
import sys

from rich.console import Console
from rich.prompt import Confirm

from src.config import load_config, save_config, has_current_tariff
from src.fetcher import fetch_market_tariffs, get_ofgem_cap
from src.comparator import compare_tariffs
from src.reporter import (
    print_banner,
    print_current_tariff,
    print_comparison_table,
    print_top_deal,
    print_switching_guide,
    console,
)
from src.setup_wizard import run_setup_wizard

OFGEM_PRICE_CAP_NOTE = (
    "All rates shown are for direct-debit customers. "
    "The Ofgem price cap sets the maximum unit rate & standing charge for "
    "variable tariffs — fixed deals may sit below the cap."
)


def run_comparison(args: argparse.Namespace) -> None:
    config = load_config()

    # First-run or explicit --setup
    if args.setup or not has_current_tariff(config):
        if not args.setup:
            console.print("[yellow]No tariff details found — let's set them up.[/yellow]\n")
        config = run_setup_wizard(config)
        save_config(config)
        console.print("[green]Configuration saved.[/green]\n")

    print_banner()

    # Fetch market data
    console.print("[dim]Fetching latest market tariffs…[/dim]")
    market_tariffs = fetch_market_tariffs(
        postcode=config.get("postcode", ""),
        verbose=args.verbose,
    )
    console.print(f"[dim]Loaded {len(market_tariffs)} tariffs.[/dim]\n")

    current, results = compare_tariffs(market_tariffs, config)

    # Show current tariff
    print_current_tariff(current, config)

    # Handle --switch mode
    if args.switch is not None:
        idx = args.switch - 1
        if idx < 0 or idx >= len(results):
            console.print(f"[red]Invalid result number. Choose 1–{len(results)}.[/red]")
            sys.exit(1)
        print_switching_guide(results[idx])
        return

    # Show comparison table
    top_n = len(results) if args.all else args.top
    print_comparison_table(current, results, top_n=top_n)

    console.print()
    print_top_deal(current, results)

    console.print(f"\n[dim]{OFGEM_PRICE_CAP_NOTE}[/dim]")
    console.print(
        "\n[dim]Run [bold]python main.py --switch N[/bold] to get the full switching guide for result #N.[/dim]"
    )
    console.print(
        "[dim]Run [bold]python main.py --setup[/bold] to update your tariff details.[/dim]\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare energy prices and find the cheapest supplier."
    )
    parser.add_argument(
        "--setup", action="store_true",
        help="Re-enter your current tariff details",
    )
    parser.add_argument(
        "--switch", type=int, metavar="N",
        help="Show full switching guide for result number N",
    )
    parser.add_argument(
        "--top", type=int, default=10, metavar="N",
        help="Number of results to show (default: 10)",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Show all available tariffs",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Show data-fetching status",
    )

    args = parser.parse_args()
    run_comparison(args)


if __name__ == "__main__":
    main()
