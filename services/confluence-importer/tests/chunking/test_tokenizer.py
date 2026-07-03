from confluence_importer.chunking.tokenizer import count_tokens


def test_returns_zero_for_empty_string():
    assert count_tokens("") == 0


def test_returns_positive_count_for_simple_word():
    assert count_tokens("hello") > 0


def test_returns_more_tokens_for_longer_text():
    short = count_tokens("Hello")
    long = count_tokens("Hello world, this is a longer sentence with more words and content.")
    assert long > short


def test_is_deterministic_for_same_input():
    text = "The quick brown fox jumps over the lazy dog."
    assert count_tokens(text) == count_tokens(text)


def test_counts_tokens_for_code_strings():
    code = "const x = 1;\nconst y = 2;\nreturn x + y;"
    assert count_tokens(code) > 0


def test_handles_whitespace_only_strings():
    assert isinstance(count_tokens("   "), int)
