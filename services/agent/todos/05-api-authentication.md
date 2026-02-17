# 05 — API-Key-basierte Auth am HTTP-Endpunkt

## Problem

Die HTTP-API in `server.ts` ist komplett offen — jeder mit Netzwerkzugang kann Requests senden und dabei den Anthropic API-Key des Servers verbrauchen. Das ist:

- **Sicherheitsrisiko**: Unbefugte können den Agent nutzen und so den API-Key missbrauchen
- **Kostenrisiko**: Unkontrollierter API-Verbrauch
- **Notwendig für Deployment**: Selbst in einem Docker-Netzwerk sollte der Endpunkt authentifiziert sein

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `src/server.ts` | Bearer-Token Middleware hinzufügen |

## Implementierungsschritte

### 1. Env-Variable definieren

```
# .env
AGENT_API_KEY=fredy-secret-key-change-me
```

### 2. Auth-Middleware in `server.ts`

```typescript
import { createMiddleware } from "hono/factory";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

const authMiddleware = createMiddleware(async (c, next) => {
  // Health-Endpunkt bleibt offen
  if (c.req.path === "/health") {
    return next();
  }

  // Wenn kein API-Key konfiguriert ist, Auth deaktivieren (Entwicklungsmodus)
  if (!AGENT_API_KEY) {
    return next();
  }

  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    return c.json({ error: { message: "Missing Authorization header" } }, 401);
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token !== AGENT_API_KEY) {
    return c.json({ error: { message: "Invalid API key" } }, 401);
  }

  return next();
});

// Middleware global registrieren
app.use("*", authMiddleware);
```

### 3. Open-WebUI Konfiguration

Open-WebUI unterstützt Bearer-Token für OpenAI-kompatible APIs. In der Connection-Konfiguration:

- **API Base URL**: `http://agent:8001/v1`
- **API Key**: Der Wert von `AGENT_API_KEY`

### 4. Docker-Compose Anpassung

```yaml
# docker-compose.yml
services:
  agent:
    environment:
      - AGENT_API_KEY=${AGENT_API_KEY}
```

## Abhängigkeiten

- Keine. Kann unabhängig von allen anderen Verbesserungen implementiert werden.
- Sollte idealerweise **vor** einem externen Deployment geschehen.

## Verifikation

1. **HTTP Test (ohne Key)**: Request ohne `Authorization`-Header an `/v1/chat/completions` → 401.
2. **HTTP Test (falscher Key)**: Request mit `Authorization: Bearer wrong-key` → 401.
3. **HTTP Test (korrekter Key)**: Request mit `Authorization: Bearer <AGENT_API_KEY>` → 200.
4. **Health-Endpunkt**: `/health` ohne Auth → 200 (bleibt offen für Health-Checks).
5. **Dev-Modus**: Ohne `AGENT_API_KEY` in Env → alle Requests erlaubt (kein Auth).
6. **Open-WebUI**: Nach Konfiguration des API-Keys in Open-WebUI funktioniert die Verbindung.
