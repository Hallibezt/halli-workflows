# Design: {{FEATURE_NAME}}

## Overview
{{What this design covers, reference to PRD if exists}}

## Requirements
{{Key requirements from PRD or user request}}

## Architecture

### High-Level Design
{{Describe the approach, include diagram if helpful}}

### Component Breakdown
| Component | Responsibility | Files |
|-----------|---------------|-------|
| {{Component}} | {{What it does}} | {{file paths}} |

## Implementation Details

### {{Section 1}}
{{Technical approach}}

### API Design (if applicable)
| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | /api/{{resource}} | — | `{ data: T[] }` |
| POST | /api/{{resource}} | `{ field: type }` | `{ data: T }` |

### Database Changes (if applicable)
```sql
CREATE TABLE {{table_name}} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  {{columns}}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Testing Strategy
- Unit: {{what to unit test}}
- Integration: {{what to integration test}}
- E2E: {{critical user flows}}

## Acceptance Criteria
- [ ] {{Testable criterion 1}}
- [ ] {{Testable criterion 2}}

## Risks and Mitigations
| Risk | Severity | Mitigation |
|------|----------|-----------|
| {{risk}} | {{high/medium/low}} | {{how to mitigate}} |
