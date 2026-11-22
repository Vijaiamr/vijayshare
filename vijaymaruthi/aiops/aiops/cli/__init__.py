"""Command-line interface for AIOps."""

__all__ = ["main"]


def main() -> None:
    """Lazy entry point (avoids the -m RuntimeWarning)."""
    from .main import main as _main

    _main()