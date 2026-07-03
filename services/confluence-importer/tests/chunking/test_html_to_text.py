from confluence_importer.chunking.html_to_text import html_to_text


def test_code_blocks_become_fenced():
    text = html_to_text("<pre><code>const x = 1;</code></pre>")
    assert "```\nconst x = 1;\n```" in text


def test_inline_code_becomes_backticks():
    text = html_to_text("<p>Use <code>kubectl</code> here</p>")
    assert "`kubectl`" in text


def test_tables_become_markdown_pipes_with_separator():
    html = "<table><tr><th>Name</th><th>Value</th></tr><tr><td>foo</td><td>bar</td></tr></table>"
    text = html_to_text(html)
    assert "| Name | Value |" in text
    assert "| --- | --- |" in text
    assert "| foo | bar |" in text


def test_empty_table_yields_empty_string():
    assert html_to_text("<table></table>") == ""


def test_single_row_table_has_no_separator():
    text = html_to_text("<table><tr><td>only</td></tr></table>")
    assert "| only |" in text
    assert "---" not in text


def test_list_items_become_bullets():
    text = html_to_text("<ul><li>first</li><li>second</li></ul>")
    assert "• first" in text
    assert "• second" in text


def test_headers_become_markdown_markers():
    text = html_to_text("<h1>Top</h1><h3>Sub</h3>")
    assert "# Top" in text
    assert "### Sub" in text


def test_br_and_hr_are_converted():
    text = html_to_text("<p>a<br>b</p><hr>")
    assert "a\nb" in text
    assert "---" in text


def test_comments_are_dropped():
    assert html_to_text("<!-- hidden --><p>visible</p>").strip() == "visible"


def test_unknown_tags_recurse_into_children():
    assert "inside" in html_to_text("<section><span>inside</span></section>")
