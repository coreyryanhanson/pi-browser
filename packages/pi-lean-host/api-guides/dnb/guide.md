---
kind: api
schemaVersion: 1
domains:
  - dnb.de
shortName: DNB
icon: 🇩🇪
apiHost: https://services.dnb.de
auth:
  kind: none
responseShape:
  format: xml
  charset: utf-8
operations:
  - name: oaiListRecords
    via: paginate
    path: /oai/repository
    accept: xml
    errorPath: OAI-PMH.error
    pagination:
      style: resumptionToken
      itemsPath: OAI-PMH.ListRecords.record
      tokenParam: resumptionToken
      tokenPath: OAI-PMH.ListRecords.resumptionToken.#text
      totalCountPath: OAI-PMH.ListRecords.resumptionToken.@_completeListSize
    params:
      verb:
        default: ListRecords
      metadataPrefix:
        default: oai_dc
---
# DNB OAI-PMH (synthetic axis guide) — resumptionToken + XML

Synthetic coverage fixture for the `resumptionToken` pagination style,
`xml-parsing`, the `errorPath` error-envelope axis, `exec-paginate`, and
`transport`. There is **no live endpoint** — exercised only against mocked
transport.

## Operations

- **`oaiListRecords`** (`paginate`, `resumptionToken`, XML) — echoes the
  opaque `resumptionToken` from each page into the next request; a terminal
  token (no `#text`) stops pagination. `totalCountPath` surfaces
  `@_completeListSize` as `serverTotal`.
- **`errorPath: OAI-PMH.error`** — an OAI-PMH error page
  (`<OAI-PMH><error code="noRecordsMatch">…</error></OAI-PMH>`, no
  `ListRecords` at all) fails loudly via the 200-envelope check instead of
  exiting the walk with silent `items: []`; a clean page has no `<error>`
  element (declared-absent = not an error).
