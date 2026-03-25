# API Spec Studio Pro

Frontend-only API workbench for turning loose request/response examples into:

- normalized payloads
- request/response specs
- Spring controller/service skeletons
- DTO bundles
- OpenAPI YAML
- JSON Schema
- mock request/response payloads
- fetch / axios client snippets
- Markdown docs
- ZIP export bundles

## Included features

- Relaxed JSON parser
  - `//` comments
  - `/* ... */` comments
  - trailing commas
  - array/object ellipsis `...`
- Line/column issue detection
- Request/response variant merging
- Editable schema overrides
  - type
  - required
  - nullable
  - format
  - description
  - enum
  - example
- Endpoint presets
- Multi-endpoint workspace
- Workspace JSON import/export
- Quick import
  - cURL
  - raw HTTP request
  - Postman collection JSON
  - OpenAPI JSON
- Snapshot save / restore / compare
- Breaking change report
- Sensitive value masking
- Panel collapse / maximize / resize / layout persistence
- Current endpoint ZIP export
- Workspace ZIP export

## Run

```bash
npm install
npm test
npm run dev
```

Open:

```text
http://localhost:4173
```

Production preview:

```bash
npm run build
npm start
```

## Scripts

- `npm run build`
- `npm run build:web`
- `npm run build:test`
- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm start`

## UI migration status

- `Alpha` mode
  - React + Vite shell
  - Dockview-based workbench layout
  - CodeMirror request/response editors
  - endpoint explorer, generated output, issue panel
- `Classic` mode
  - existing full-featured workbench preserved during migration
