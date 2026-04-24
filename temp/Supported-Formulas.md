# Supported Formulas

This sheet engine currently supports a limited subset of spreadsheet formulas. Function names are case-insensitive and use comma-separated arguments.

| Category | Function | Status | Notes |
| --- | --- | --- | --- |
| Aggregate | `SUM` | Supported | Accepts scalar args and ranges. |
| Aggregate | `AVERAGE` | Supported | Accepts scalar args and ranges. |
| Aggregate | `MIN` | Supported | Accepts scalar args and ranges. |
| Aggregate | `MAX` | Supported | Accepts scalar args and ranges. |
| Aggregate | `COUNT` | Supported | Counts numeric values only. |
| AI | `AI` | Supported | `AI(prompt, [range])` uses the selected sheets AI model and returns generated text. |
| Logical | `IF` | Supported | Requires exactly 3 arguments. |
| Logical / Error | `AND` | Supported | Treats non-zero numbers and non-empty text as truthy. |
| Logical / Error | `OR` | Supported | Treats non-zero numbers and non-empty text as truthy. |
| Logical / Error | `NOT` | Supported | Single-argument logical negation. |
| Logical / Error | `IFERROR` | Supported | Supports `IFERROR(value)` and `IFERROR(value, fallback)`. |
| Math / Stat | `ROUND` | Supported | Supports 1 or 2 arguments. |
| Math / Stat | `ROUNDUP` | Supported | Supports 1 or 2 arguments. |
| Math / Stat | `ROUNDDOWN` | Supported | Supports 1 or 2 arguments. |
| Math / Stat | `INT` | Supported | Floors toward negative infinity. |
| Math / Stat | `ABS` | Supported | Single numeric argument. |
| Math / Stat | `MOD` | Supported | Spreadsheet-style modulo. |
| Math / Stat | `POWER` | Supported | Two numeric arguments. |
| Math / Stat | `SQRT` | Supported | Errors on negative input. |
| Math / Stat | `MEDIAN` | Supported | Accepts scalars and ranges. |
| Conditional Aggregate | `SUMIF` | Supported | Supports `SUMIF(range, criterion)` and `SUMIF(range, criterion, sum_range)`. |
| Conditional Aggregate | `COUNTIF` | Supported | Supports standard two-argument form. |
| Conditional Aggregate | `AVERAGEIF` | Supported | Supports `AVERAGEIF(range, criterion)` and optional third range. |
| Text | `CONCAT` | Supported | Concatenates all scalar/range inputs. |
| Text | `LEFT` | Supported | Optional second argument defaults to 1. |
| Text | `RIGHT` | Supported | Optional second argument defaults to 1. |
| Text | `MID` | Supported | Uses Google Sheets argument order. |
| Text | `LEN` | Supported | Returns character count. |
| Text | `TRIM` | Supported | Collapses repeated whitespace to single spaces. |
| Text | `UPPER` | Supported | Single text argument. |
| Text | `LOWER` | Supported | Single text argument. |
| Text | `PROPER` | Supported | Title-cases alphanumeric word segments. |
| Text | `FIND` | Supported | Case-sensitive; optional start position. |
| Text | `SUBSTITUTE` | Supported | Supports optional occurrence index. |
| Text | `REPLACE` | Supported | Uses 1-based start index. |
| Text | `TEXT` | Supported | Common subset only: `0`, `0.0`, `0.00`, `#,##0`, `#,##0.0`, `#,##0.00`, `0%`, `0.0%`, `0.00%`, `yyyy-mm-dd`, `hh:mm:ss`, `yyyy-mm-dd hh:mm:ss`. |
| Text | `VALUE` | Supported | Parses numbers, grouped numbers, percentages, time-only strings, and simple `YYYY-MM-DD[ HH:MM[:SS]]` date/time strings. |
| Date / Time | `DATE` | Supported | Normalizes year/month/day into a serial date value. |
| Date / Time | `YEAR` | Supported | Extracts year from serial date/time. |
| Date / Time | `MONTH` | Supported | Extracts month from serial date/time. |
| Date / Time | `DAY` | Supported | Extracts day from serial date/time. |
| Date / Time | `HOUR` | Supported | Extracts hour from serial date/time. |
| Date / Time | `MINUTE` | Supported | Extracts minute from serial date/time. |
| Date / Time | `SECOND` | Supported | Extracts second from serial date/time. |
| Date / Time | `TODAY` | Supported | No-argument current date serial. |
| Date / Time | `NOW` | Supported | No-argument current date-time serial. |
| Info | `ISBLANK` | Supported | True only for empty values. |
| Info | `ISNUMBER` | Supported | True only for numeric values. |
| Info | `ISTEXT` | Supported | True only for text values. |
| Info | `ISERROR` | Supported | Returns true when evaluating the argument raises a formula error. |
| Lookup / Reference | `XLOOKUP` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `VLOOKUP` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `HLOOKUP` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `INDEX` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `MATCH` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `XMATCH` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `OFFSET` | Deferred | Requires broader engine architecture. |
| Lookup / Reference | `INDIRECT` | Deferred | Requires broader engine architecture. |
| Array / Query | `FILTER` | Deferred | Requires broader engine architecture. |
| Array / Query | `SORT` | Deferred | Requires broader engine architecture. |
| Array / Query | `UNIQUE` | Deferred | Requires broader engine architecture. |
| Array / Query | `SEQUENCE` | Deferred | Requires broader engine architecture. |
| Array / Query | `TRANSPOSE` | Deferred | Requires broader engine architecture. |
| Text | `TEXTJOIN` | Deferred | Requires broader engine architecture. |
| Logical | `IFS` | Deferred | Requires broader engine architecture. |
| Conditional Aggregate | `SUMIFS` | Deferred | Requires broader engine architecture. |
| Conditional Aggregate | `COUNTIFS` | Deferred | Requires broader engine architecture. |
| Conditional Aggregate | `AVERAGEIFS` | Deferred | Requires broader engine architecture. |

## Current Engine Rules

| Rule | Status |
| --- | --- |
| Function names are case-insensitive | Supported |
| Commas are used for argument separation | Supported |
| Scalar functions return scalar values | Supported |
| Ranges work only in supported function contexts | Supported |
| Sheet-qualified references like `Sheet1!A1` | Unsupported by design |
| Absolute references like `$A$1` | Deferred |
| Named ranges | Deferred |
| Spill arrays / array formulas | Deferred |
