# User Registration Contract

## Endpoint

`POST /auth/register`

Registration is public and does not require an authentication cookie.

## Request

Send a JSON object with `Content-Type: application/json`.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `email` | string | Yes | Stored in a column with a maximum length of 100 characters. |
| `password` | string | Yes | Hashed with bcrypt before storage; never returned by this endpoint. |
| `firstName` | string | Yes | Stored in a column with a maximum length of 50 characters. |
| `lastName` | string | Yes | Stored in a column with a maximum length of 50 characters. |

Example:

```json
{
  "email": "alex@example.com",
  "password": "a-long-secret",
  "firstName": "Alex",
  "lastName": "Taylor"
}
```

The current handler checks that all four values are present and truthy. It does
not currently validate email format, trim whitespace, or enforce password
strength rules.

## Responses

### `201 Created`

The account was registered. No user record or authentication token is returned.

```json
{
  "statusCode": 201,
  "message": "OK"
}
```

### `400 Bad Request`

One or more required fields are missing or empty:

```json
{
  "statusCode": 400,
  "message": "Bad request",
  "stack": {}
}
```

A duplicate email that is caught by the database's unique constraint also
returns `400` with `"Account already exists"`.

### `404 Not Found`

An account with that email already exists when checked before insertion:

```json
{
  "statusCode": 404,
  "message": "Account already exists",
  "stack": {}
}
```

The existing-account response currently differs depending on whether the
duplicate is found by the initial lookup or by the database constraint.

### `500 Internal Server Error`

Unexpected failures are handled by the API's common error handler. In
development, the response may include a stack trace; in other environments,
`stack` is an empty object.
