"""Structured-ish stdlib logging setup shared by the CLI and the scheduler."""

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)-5s %(name)s %(message)s"

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}


def configure_logging(level: str = "info") -> None:
    """Configure the root logger once. ``level`` matches the TS values (debug|info|warn|error)."""
    logging.basicConfig(
        level=_LEVELS.get(level, logging.INFO),
        format=_FORMAT,
        stream=sys.stderr,
        force=True,
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
