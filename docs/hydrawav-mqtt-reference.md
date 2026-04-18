# HydraWav MQTT API Notes (from Hackathon PDF)

Source file used:

- `/Users/deepnayak/Downloads/HydraWav Device (MQTT) Control API Documentation (HydraWav3Pro).pdf`

## 1) Authenticate

- Method: `POST`
- Endpoint: `/api/v1/auth/login`
- Body:

```json
{
  "username": "string",
  "password": "string",
  "rememberMe": true
}
```

- Response fields include:
  - `JWT_ACCESS_TOKEN`
  - `JWT_REFRESH_TOKEN`

Use `JWT_ACCESS_TOKEN` as bearer token for publish requests.

## 2) Publish MQTT Command

- Method: `POST`
- Endpoint: `/api/v1/mqtt/publish`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <access_token>`
- Body shape:

```json
{
  "topic": "HydraWav3Pro/config",
  "payload": "STRINGIFIED_JSON"
}
```

Important:

- `payload` must be a **stringified JSON**, not a raw object.
- Quotes are escaped in transit by JSON encoding.

## 3) Command Payloads

Topic for all commands:

- `HydraWav3Pro/config`

Start session:

```json
{
  "mac": "74:4D:BD:A0:A3:EC",
  "playCmd": 1
}
```

Pause:

```json
{
  "mac": "74:4D:BD:A0:A3:EC",
  "playCmd": 2
}
```

Stop:

```json
{
  "mac": "74:4D:BD:A0:A3:EC",
  "playCmd": 3
}
```

Resume:

```json
{
  "mac": "74:4D:BD:A0:A3:EC",
  "playCmd": 4
}
```

## 4) Note on Pause Value

The PDF has an inconsistency:

- Pause request example shows `playCmd: 2`
- Play command table lists Pause as `3`

Implementation in this project follows the explicit request examples:

- Start `1`
- Pause `2`
- Stop `3`
- Resume `4`
