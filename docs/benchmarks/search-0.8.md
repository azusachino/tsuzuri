# Search benchmark for 0.8.0

Measured on 2026-09-26 on an Apple M2 with Node 22.23.3. A synthetic vault held 10,248 Markdown files, each with a heading and twelve repetitions of a short sentence about working memory and cognitive load. A single `Vault` loaded the tree before timing. Twenty calls then alternated `search("cognitive load")` and `search("working memory")` on the warm scan.

| Code | Median per search | Range |
| --- | ---: | ---: |
| Before #96 (`405789d`) | 37.07 ms | 31.24–45.67 ms |
| Scan-held lowercase text and counts | 20.97 ms | 19.02–31.46 ms |
| Second run after #96 | 22.49 ms | 19.42–40.17 ms |

The cache cut warm search time by roughly 40% on this repetitive synthetic tree. This does not measure cold scan time or a varied real vault. The benchmark fixture and runner are local scratch files under the workstation's `.tmp/tsuzuri-search-96/`; SDK tests lock the result order, scores, snippets, and reload behavior.
