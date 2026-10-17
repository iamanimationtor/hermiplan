# HERMIPLAN export audit

## Scope and pre-change baseline

Audited the user flow from the report/builder download controls through `POST /api/export` and the bytes produced for each download. The report UI exposes seven choices: printable HTML (`pdf` is a legacy API id; the response is **not** a PDF byte stream), XLSX, Excel 2003 SpreadsheetML (`.xls`), one-table CSV, JSON, MS Project XML, and a ZIP delivery package. The builder also has direct XLSX, MS Project XML, and ZIP download controls. Browser printing is a separate action.

| Format | Existing generator / path | Baseline finding |
| --- | --- | --- |
| Printable HTML | `ReportView` / `buildReportHtml`; `pdf` id in `/api/export` downloads `.html` | This was the working self-contained HTML report with print CSS and embedded Gantt SVG. It must remain described as HTML/Print-to-PDF rather than be mislabeled as a generated PDF. The baseline did not test a real browser print dialog. |
| XLSX | `buildSheets` → hand-written OOXML in `buildXlsx` → custom ZIP writer | It was a ZIP/OOXML workbook, but regression tests only searched XML text. Dates were inline strings, numeric styles were generic, and the Activities table lacked dependency details, constraints, notes/deliverables and assignment units. There were no dedicated dependency/assignment/calendar tables, usable Gantt timeline, or independent spreadsheet-reader test. |
| `.xls` | `buildExcelXml` (SpreadsheetML 2003, not legacy BIFF) | It was an XML spreadsheet, not a binary BIFF workbook. Fixed column widths and date/percent presentation, filtering and frozen headings were not covered by tests. |
| CSV | `buildCsv`; API accepts one sheet `kind` (defaults to Activities) | UTF-8 BOM, CRLF and formula-prefix mitigation were present. CSV is one table per file, but the report UI did not expose the sheet selector and replaced the server's specific download filename. |
| JSON | `/api/export` serializes project + analysis | The full project and analysis were included, but an unrelated `reportSections` field was added under project metadata. There was no always-on round-trip regression for all current input fields. |
| MS Project XML | `buildMsProjectXml` | XML had tasks/dependencies/resources, but resource type and capacity mapping were inaccurate, each assignment could repeat task-level work/cost, and task constraints/notes and calendar holidays were omitted. The tests only checked opening/closing tags. |
| ZIP package | `buildDeliveryPackage` | A ZIP with six entries omitted `.xls` and CSV tables other than Activities; its JSON payload differed from the direct JSON export. Tests did not validate all entry CRCs/payloads. |

### Baseline verification

Before implementation, on `arena/a0d59d26-hermiplan`, `npm ci`, `npm test`, `npm run typecheck` and `npm run lint` completed successfully. Those checks did not independently reopen the workbook, compare all exported input data to the source, or exercise every export API response without a database.

## Repairs made

- **XLSX / report data:** rebuilt the sheet model with typed date, percentage, currency and styled cells. XLSX dates are native Excel date serials with date number formats; percentages are stored as fractions; numeric values remain numeric; user text is written as inline strings, not formulas. Added widths, wrapping, frozen headings/columns, filters, RTL views, print settings and an adaptive daily/weekly/monthly Gantt sheet. Added dependency, assignments, calendar, WBS, milestone, risk, cost, EVM, baseline and checks data where available. Raw input activities stay visible even if scheduling fails; calculated fields are left blank instead of invented. Baseline finish variance is current finish date minus baseline finish date, not a duration change.
- **Gantt honesty:** planned bars show scheduled start/finish. Progress remains an explicit percentage; a partial percentage is no longer spread across dates as if actual completion dates were known. The report explains that distinction.
- **SpreadsheetML `.xls`:** produces a styled SpreadsheetML 2003 XML workbook with per-column widths, typed date/number values, percentages, filters, frozen headings, RTL and print settings. The UI now explicitly says this is XML with an `.xls` extension, not BIFF.
- **CSV:** added a report-UI table selector and availability checks, aligned with the actual sheets. CSV retains UTF-8 BOM/CRLF and neutralizes spreadsheet formula prefixes in text while preserving numeric cells. The API returns a table-specific filename.
- **JSON:** exports `schemaVersion`, the full serializable project, deterministic analysis, date-encoding note and report options; it no longer modifies project metadata with export-only fields.
- **MS Project XML:** carries source tasks even when the schedule cannot calculate them, relationship types and working-day lags, task constraints/notes/deliverables, project calendar and holidays, resource type/capacity and assignments. Work quantities are emitted only for labor/equipment assignments. XML values are escaped/filtered; missing calculated fields are omitted rather than fabricated. The JSON companion remains the lossless source for HERMIPLAN-specific fields.
- **ZIP:** now includes README, HTML, XLSX, SpreadsheetML `.xls`, MSPDI XML, the same JSON shape as the direct export, and a CSV for each available workbook table. The custom ZIP writer supports DEFLATE and CRCs; ZIP64 is not implemented.
- **Download path:** API validates formats and CSV table names, returns safe Unicode RFC 5987 filenames and no-cache/nosniff headers. Both report and builder honor the server filename instead of overwriting it, reject empty downloads, and defer object-URL revocation. Filename handling includes Unicode/surrogate edge cases.
- **HTML report:** keeps source activities visible when some cannot be scheduled and labels those rows; calculated dates/float remain blank. The legacy `pdf` id is explicitly labeled as printable standalone HTML.
- **Security maintenance:** upgraded Next.js and `eslint-config-next` together from 16.2.6 to 16.4.2, updated PostCSS to 8.5.30, and overrode ExcelJS's vulnerable `uuid` 8.x dependency to compatible `uuid` 11.1.1. The production dependency audit is now clean. Remaining full-audit findings are confined to development tooling and are listed below.

## Post-change verification

Executed successfully on this branch:

- `npm ci` — clean lockfile install completed; NPM reported 9 remaining development-tree advisories.
- `npm test` — all engine, template, import, edge-case and export tests passed. Export-specific results: 19 default report sections, an 18-sheet workbook opened by ExcelJS, and a 24-entry package whose ZIP contents/CRCs were checked. API route tests exercised all seven output choices and validated headers and file bodies; they also covered CSV selection/errors, Unicode filenames, an empty project, a 500-activity project, cyclic/unschedulable input, and a 24-entry package.
- `npm run typecheck` — passed (`tsc --noEmit`).
- `npm run lint` — passed (`eslint .`).
- `npm run build` — passed with Next.js 16.4.2; the export route built as a dynamic API route.
- `npm audit --omit=dev --audit-level=moderate` — passed; **0 production vulnerabilities**.
- Production preview smoke check: `/` and `/builder` returned HTTP 200. A real HTTP `POST /api/export` XLSX request returned 200 with the expected MIME type and safe headers; the 41,609-byte response had 23 ZIP entries and passed Python `zipfile.testzip()`.
- A synthetic 200-activity chain, including analysis, Gantt SVG and ZIP packaging, measured **228 ms** and **230,404 bytes** in this sandbox. This is one local measurement, not a production latency guarantee.

The workbook was independently opened and inspected using ExcelJS 4.4.0, and XML/ZIP structure was checked with `fast-xml-parser` and test helpers. This is useful interoperability evidence, but it is **not** a Microsoft Excel, LibreOffice, Microsoft Project or Primavera application acceptance test, nor an official OOXML/MSPDI schema certification.

## Remaining limits and checks not run

- The `pdf` API id still returns `.html`; the user can open it and choose Print → Save as PDF. No PDF binary renderer was added, and browser print output was not tested in a real browser.
- `.xls` means SpreadsheetML 2003 XML with an `.xls` suffix, not BIFF. XML well-formedness is tested; Excel 2003/other spreadsheet applications were not opened here.
- MS Project XML is checked for well-formed XML and data mapping, but has not been imported into Microsoft Project/Primavera and was not validated against an official MSPDI XSD. Do not infer guaranteed application compatibility from these tests.
- The database-backed `scripts/api-integration.ts` suite was not run; it requires a running app plus configured database/auth integration. No `DATABASE_URL` is configured in this sandbox, so `/api/health` returns HTTP 500 here even though `/`, `/builder` and the no-DB export route work. The new direct route regression calls `POST /api/export` in-process and does not need a database.
- The current full `npm audit` reports **9 development-tree vulnerabilities (4 moderate, 5 high)**, in the Next ESLint dependency chain (`fast-glob`/`micromatch`/`braces`) and Drizzle Kit's deprecated `@esbuild-kit` chain. NPM's suggested fixes require incompatible major downgrades (Next ESLint config 14.x or Drizzle Kit 0.18.x); these were not forced. The production audit is clean, and ExcelJS's `uuid` and PostCSS advisories were addressed.
- ZIP64 is unsupported; the writer rejects archives/entries above classic ZIP limits. The API also enforces its existing 3 MB request-body limit.

