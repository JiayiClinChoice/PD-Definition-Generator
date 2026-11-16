# PD Definition Generator Backend

A FastAPI backend for project management, protocol parsing, fact extraction, and PD definition generation.

## Quick Start

### 1) Requirements

- Python 3.11+
- Windows / Linux / macOS

### 2) Install

```powershell
cd Backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3) Configure

```powershell
Copy-Item .env.example .env
```

Then fill:

- `GPT_API_URL`
- `GPT_API_KEY`
- `GPT_MODEL`

Accounts and project configuration work without AI credentials. AI operations return
503 until all three values are configured.

### 4) Run

```powershell
.\.venv\Scripts\python.exe run.py
```

Default address: `http://127.0.0.1:8001`

## Architecture

```text
Backend/
  app/
    application.py           # FastAPI app factory + lifecycle
    api/
      dependencies.py        # dependency injection and guards
      router.py              # top-level router composition
      routes/
        system.py            # /healthz
        projects.py          # project-related APIs
    services/
      project_workflows.py   # orchestration for AI + DB workflows
  ai/                        # OpenAI integration and prompt bridge
  database/
    models.py                # SQLAlchemy models
    repositories.py          # persistence-only DB operations (CRUD/query)
    domain_services.py       # business/domain rules and validation
  configs.py                 # runtime settings
  schemas.py                 # Pydantic schemas
  main.py                    # ASGI entrypoint (app = create_app())
  run.py                     # local launcher
```

## Engineering Rules

1. Router layer: focuses on validation and HTTP contract.
2. App service layer: orchestrates external dependencies and workflow.
3. Domain service layer: owns business rules and consistency checks.
4. Repository layer: owns SQLAlchemy query/update details only.
5. Shared guard: all AI-heavy routes use per-project operation lock.
6. Strict schemas: request/response contracts are explicit and reusable.

## API Examples

### Authentication

`X-User-Id` is no longer accepted as authentication. Register through the UI or
`POST /auth/register`, then use `POST /auth/login`, `GET /auth/me`, and
`POST /auth/logout`. Usernames are case-insensitive (3–32 letters, digits or
`. _ @ -`); passwords must contain 3–128 characters.

Passwords use salted PBKDF2-SHA256. Sessions are random, revocable tokens stored
as hashes in the database; the browser receives an HttpOnly, SameSite=Strict cookie.
Logout invalidates the current session on the server. Each account owns its own
projects; other accounts receive 404 for every project read/write/AI operation.
Project sharing and member roles are not part of this version.

All mutating requests require `X-Requested-With: ProtocolDeviationGenerator`.
Use a same-origin reverse proxy for the browser API, as the Vite development
proxy does. No credential or account identifier belongs in frontend environment
variables or browser localStorage.

### List projects (after login, using a cookie jar)

```powershell
curl.exe -b cookies.txt "http://127.0.0.1:8001/projects"
```

### Attach a protocol file

```powershell
curl.exe -X POST "http://127.0.0.1:8001/project/1/attach" `
  -b cookies.txt -H "X-Requested-With: ProtocolDeviationGenerator" `
  -F "file=@C:\docs\protocol.pdf;type=application/pdf"
```

### Workspace and editing

- `GET /project/{id}/workspace` returns the project, saved categories, field rules,
  facts and definitions. Reading it never invokes AI.
- `PUT /project/{id}/pd_categories` replaces the category configuration and clears
  facts transactionally. Existing definitions are retained for manual review.
  Category order and names must be unique.
- `PUT /project/{id}/update_fields` saves meaning, allowed values, requirements
  and examples. Field identity, label and required status remain fixed by the
  typed AI output schema; unsupported structural edits return 422, never a reset.
- `PUT /project/{id}/facts` and `PUT /project/{id}/definitions` save manual edits,
  including deletion of all rows, with normalized 1-based positions.
- `POST /project/{id}/extract_facts` and
  `POST /project/{id}/generate_definitions` explicitly run AI.
  The old GET generation endpoints are deprecated and also require the request
  verification header. Use the workspace endpoint for reading stored results.
- AI operations and deletion share a per-project operation lock. Configuration
  and manual-result edits are rejected while AI is operating. Failed AI calls
  release the lock and preserve existing results.
- Each project accepts one non-empty PDF, DOC, DOCX, Markdown or text file.
  AI extraction requires a validated protocol; definition generation additionally
  requires saved facts.

Tables are created automatically at startup, including the account/session tables.
Legacy header-only identities are not automatically claimable through registration.

### Project prompts and AI interaction history

- `project_prompts` stores six templates per project: `system`, `validation`,
  `extract`, `revise_facts`, `generate`, and `revise_definitions`. New projects
  receive defaults from `ai/prompt.py` in the project-creation transaction.
  Startup backfills missing templates for existing projects without overwriting
  customized values. No existing table columns need to be changed.
- `GET /project/{id}/prompts` reads the templates; `PUT` at the same path saves
  the complete template object. Ownership and the project AI lock apply.
  Templates use `$variable` / `${variable}` syntax. Required context variables
  must be retained, unknown variables are rejected, and literal `$` is `$$`.
- `POST /project/{id}/prompt_preview` accepts `{operation, prompts, requirements}`
  and returns `{instructions, messages}` without invoking AI or saving changes.
  Operations: `validate`, `extract`, `revise_facts`, `generate`,
  `revise_definitions`. Revision operations require `requirements`.
  Preview and sending share the same conversation builder. Before upload,
  validation previews use a file-ID placeholder; the UI names the selected file.
- `ai_interactions` stores one row per application AI request, including project,
  operation, model, UTC start time, integer `duration_ms`, status
  (`pending`/`completed`/`failed`), structured `conversation`, raw JSON `response`
  and error text. Conversation includes the system instruction, all request
  turns, and returned output items (including refusals/reasoning when supplied).
  File attachments are referenced by file ID, not duplicated as document text.
  Raw response data is saved before structured parsing, including parsing failures.
  File upload/deletion calls are not conversational AI requests.
- Pending rows are committed before network I/O; completion/failure is committed
  independently of saving business results. Duration covers the AI call,
  SDK retries and response parsing, not upload or result persistence. Process
  termination may leave a `pending` row with null duration.
- `GET /project/{id}/ai_interactions?offset=0&limit=20` reads history newest first
  (maximum limit 100), restricted to the project owner. Deleting a project also
  deletes its prompts and interaction history.

Conversation history may contain protocol and study information. Include these
tables in your access-control, backup and data-retention policies.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Tests use a temporary SQLite database and mocked AI responses; they never modify
the application database or contact an AI provider.

## Security Notes

- Never commit real secrets.
- Disable `APP_RELOAD` in production.
- Serve over HTTPS and set `AUTH_COOKIE_SECURE=true` in production.
- Session duration defaults to 14 days. Failed authentication is limited per
  username and source IP; configure `AUTH_*` values in `.env` as needed.
- With a reverse proxy, configure trusted proxy addresses explicitly so IP limits
  use the intended client address. Also enforce gateway-level rate limits.
- Add ingress request-size/rate limits at gateway level.
- Apply proper access-control and retention policy for sensitive files.
