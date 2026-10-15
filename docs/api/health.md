# Health contract

`GET /health` is public, unversioned, and checks PostgreSQL with `SELECT 1`.

Successful response, HTTP 200:

```json
{ "data": { "status": "ok", "database": "up" } }
```

Database failure after startup, HTTP 503:

```json
{
  "statusCode": 503,
  "error": "Service error",
  "message": "Database is unavailable",
  "requestId": "server-generated-uuid"
}
```

Application responses include `X-Request-Id`. No database credentials or connection strings are returned. Connection failures during startup can prevent the API from listening. No authentication or payment operations are exposed in foundation. Future business routes use `/api/v1` and enforce authentication and business ownership server-side.
