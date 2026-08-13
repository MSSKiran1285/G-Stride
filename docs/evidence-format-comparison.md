# Evidence PDF format comparison

## Documents reviewed

- Current generated evidence: `evidence[1].pdf` — 22 pages.
- Target reference: `O2C-Training-Evidence-Document.pdf` — 31 pages.

## Material differences found

| Area | Current generated document | Target reference |
|---|---|---|
| Cover | Mostly empty first page with a technical mode/app ID heading | Full title page with process name, flow subtitle, overall result, and complete run metadata |
| Executive summary | Basic run fields and raw output-key names | Numbered metadata table, total duration, tenant/environment, test-case ID, and business-document results |
| Chapters | Standalone “Scenario Chapters” page followed by combined introduction and step table | Section heading and first chapter introduction together; business step table starts on a clean page |
| Step table | Action, value, status, duration, and error | Business Action, Value Entered, Why, Result, and Duration |
| Screenshots | Technical label below a bordered screenshot | Numbered figure caption above each screenshot, grouped by scenario, final-state proof first |
| Traceability | Field, type, and value | Field, type, value, production/consumption context, and test-case ID |
| Training content | Present but lightly structured | Numbered practice exercise, checkpoints, and self-check quiz |
| Page furniture | Repeated technical run header and page counter | Clean document pages with stronger section hierarchy |
| PDF metadata | No document title | Descriptive PDF title |

## Implemented target format

The audit evidence generator now produces:

1. A populated G-Stride cover.
2. Complete execution metadata, including calculated duration and the tenant inferred from recorded navigation evidence.
3. Business-document results rather than raw output names.
4. Numbered process, scenario, traceability, training, and appendix sections.
5. Business-facing step tables with a transparent generated “Why” description.
6. Numbered screenshot evidence with the final proof shown first.
7. A detailed traceability matrix while retaining the verbatim raw audit log.

No evidence values are invented. Optional narrative, learning, error-guidance, and training content is included only when supplied by the process suite and test-case definitions.
