import logging

from confluence_importer.logging import configure_logging, get_logger


def test_configure_logging_sets_level():
    configure_logging("debug")
    assert logging.getLogger().level == logging.DEBUG
    configure_logging("warn")
    assert logging.getLogger().level == logging.WARNING


def test_unknown_level_falls_back_to_info():
    configure_logging("bogus")
    assert logging.getLogger().level == logging.INFO


def test_get_logger_returns_named_logger():
    assert get_logger("x.y").name == "x.y"
