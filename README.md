# csv-reader-speed-20261121-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/sinker234/csv-reader-speed-20261121-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/sinker234/csv-reader-speed-20261121-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in replacement for make.fun's csv-reader 1.0.0: it reads broken CSV files — stray CRs, unterminated quotes, junk after a closing quote, ragged rows, BOM, CRLF and multiline quoted fields — and returns byte-identical answers ({columns, rows, errors}) on every case. Instead of walking one character at a time like the reference, it jumps with indexOf and a delimiter regex and slices whole fields at once: a record whose line holds no quote and no stray CR is split in a single native call, and quoted fields jump straight to their closing quote. About 4× faster than csv-reader on the practice set (median 113 ms vs 480 ms for 10.2 MB of CSV), verified identical on all 6 practice cases, 20,000 random fuzz inputs and 3,000 generator-style structured fuzz inputs.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

Node 22.18 or later, standard library only. The program reads every case from `input/cases.json`, answers each with `run` from `solve.js`, and writes `output/answers.json`, byte for byte the same on every run.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1c94brae&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
