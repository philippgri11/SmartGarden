# Irrigation Control for Raspberry Pi and k3s

Eine wartbar strukturierte Bewässerungssteuerung mit FastAPI, Angular, PostgreSQL, Docker und Kubernetes/k3s. Das Projekt ist so aufgebaut, dass du lokal auf dem Mac mit Simulation entwickeln kannst und später dieselben Container- und Kubernetes-Prinzipien auf einem Raspberry Pi mit k3s weiterverwendest.

## Architektur

Die Architektur trennt API, Scheduler und Hardwarezugriff bewusst:

- `backend`: FastAPI-API für Zonen, Zeitpläne, Historie, Einstellungen und Not-Aus.
- `scheduler`: eigenständiger Worker-Prozess, der fällige Jobs plant, Weather-Checks ausführt und allein GPIO-seitig schreibt.
- `frontend`: Angular-Standalone-App für Dashboard, Zonen, Zeitpläne, Historie, Konfiguration und interaktive Gartenkarte.
- `postgres`: zentrale Persistenz für Zonen, Zeitpläne, Läufe, Wetterentscheidungen und globale Einstellungen.

Wichtig: Das API-Backend ist horizontal skalierbar. Scheduler und GPIO-Schreibzugriff laufen nur einmal. Zusätzlich schützt ein PostgreSQL-Advisory-Lock vor doppelter Job-Ausführung.

## Mermaid

### System Context

```mermaid
flowchart LR
    User["Benutzer"] --> UI["Angular Frontend"]
    UI --> API["FastAPI Backend"]
    API --> DB["PostgreSQL"]
    UI --> Map["Leaflet Gartenkarte"]
    Map --> API
    Scheduler["Scheduler Worker"] --> DB
    Scheduler --> Weather["Open-Meteo API"]
    Scheduler --> GPIO["GPIO Adapter"]
    GPIO --> Valves["Ventile / Relais / Pumpen"]
```

### Container Overview

```mermaid
flowchart TB
    subgraph Cluster["Docker Compose oder k3s/k3d"]
      Frontend["frontend deployment"]
      Backend["backend deployment (N replicas)"]
      Scheduler["scheduler deployment (1 replica)"]
      Postgres["postgres statefulset"]
    end
    Frontend --> Backend
    Backend --> Postgres
    Scheduler --> Postgres
    Scheduler --> OpenMeteo["Open-Meteo"]
    Scheduler --> Gpio["SimulatedGpioAdapter / RealGpioAdapter"]
```

### Scheduling Flow

```mermaid
flowchart TD
    Tick["Scheduler Tick"] --> Lock{"Advisory Lock erhalten?"}
    Lock -- Nein --> Wait["Warten bis nächster Tick"]
    Lock -- Ja --> Due["Fällige Schedule Slots berechnen"]
    Due --> Planned["Geplante watering_runs anlegen"]
    Planned --> Weather{"Wetterprüfung aktiv?"}
    Weather -- Ja --> Decide["Open-Meteo auswerten"]
    Weather -- Nein --> Start["Zone aktivieren"]
    Decide -->|allow| Start
    Decide -->|skip/error| History["Als skipped/failed protokollieren"]
    Start --> Running["Run läuft"]
    Running --> Finish["Bei Stop/Timeout deaktivieren"]
```

### Weather Decision Flow

```mermaid
flowchart LR
    Request["Run soll starten"] --> Enabled{"Weather aktiv?"}
    Enabled -- Nein --> Allow["allow"]
    Enabled -- Ja --> Fetch["Forecast laden"]
    Fetch --> Error{"API Fehler?"}
    Error -- Ja + allow --> Allow
    Error -- Ja + deny --> Block["error / block"]
    Error -- Nein --> Compare["Thresholds vergleichen"]
    Compare -->|Regen erwartet| Skip["skip"]
    Compare -->|unter Threshold| Allow
```

### Deployment Mac vs Raspberry Pi

```mermaid
flowchart TB
    Mac["Mac Entwicklung"] --> Compose["docker compose up --build"]
    Mac --> K3d["k3d / lokales k3s-nahes Testen"]
    Compose --> Sim["GPIO_MODE=simulated"]
    K3d --> Sim
    Mac --> Build["build-arm64.sh"]
    Build --> Sync["sync-to-pi.sh"]
    Sync --> Pi["Raspberry Pi + k3s"]
    Pi --> Real["GPIO_MODE=real + /dev/gpiochip0 hostPath"]
```

## Repository-Struktur

```text
backend/
frontend/
k8s/
scripts/
docker-compose.yml
README.md
```

## Backend

- FastAPI mit OpenAPI, `/health/live` und `/health/ready`
- SQLAlchemy + Alembic
- Hexagonal angelegt über `application`, `domain` und `infrastructure`
- `SimulatedGpioAdapter` für Mac und `RealGpioAdapter` als vorbereiteter Platzhalter für `libgpiod`
- Safety-Regeln:
  - Maximaldauer pro Zone wird erzwungen
  - Scheduler setzt beim Start alle Zonen auf OFF
  - Bei Scheduler-Fehlern werden alle aktiven Zonen gestoppt
  - Not-Aus API: `POST /api/watering/stop-all`

## Frontend

- Angular Standalone Components
- Bereiche:
  - Dashboard
  - Zonen
  - Zeitpläne
  - Historie
  - Konfiguration
  - Gartenkarte mit Leaflet Simple CRS, Bild-Overlay und Polygon-Zeichnen

### Interaktive Gartenkarte

Die Gartenkarte ist für lokale Bildkoordinaten ausgelegt und braucht keine echten GPS-Koordinaten. Im Frontend wird Leaflet mit `CRS.Simple` verwendet, damit du ein Gartenbild als statischen Hintergrund laden und darauf Zonen als Polygone einzeichnen kannst.

Vorhandene Funktionen:

- Gartenkarte anlegen, bearbeiten und löschen
- Gartenbild per `image_url` als Hintergrund laden
- Polygone für Zonen zeichnen, bearbeiten und löschen
- Zuordnung eines Polygons zu genau einer Zone
- Farbcodierte Zustände direkt auf der Karte:
  - grau = deaktiviert
  - grün = aktiv
  - blau = läuft gerade
  - orange = in den nächsten 12 Stunden geplant
  - rot = letzter Lauf fehlgeschlagen
- Klick auf eine Fläche zeigt:
  - Zonenname
  - Status
  - nächste Bewässerung
  - letzte Bewässerung
  - Wetterabhängigkeit
  - Aktionen für Start, Stop und Wechsel zur Zeitplanverwaltung

API-Endpunkte für die Kartenfunktion:

- `GET /api/maps`
- `POST /api/maps`
- `PUT /api/maps/{map_id}`
- `DELETE /api/maps/{map_id}`
- `GET /api/maps/{map_id}/view`
- `POST /api/maps/shapes`
- `PUT /api/maps/shapes/{shape_id}`
- `DELETE /api/maps/shapes/{shape_id}`

## Lokale Entwicklung auf dem Mac

### Voraussetzungen

- Docker Desktop
- optional: `kubectl`, `k3d`

### Start mit Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Danach:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8000`
- OpenAPI: `http://localhost:8000/docs`
- Postgres: `localhost:5432`

Die Gartenkarte erreichst du im Frontend über den Menüpunkt `Gartenkarte`. Für einen schnellen Start kannst du zuerst eine Karte mit Bild-URL und Größe anlegen und danach Polygone für bestehende Zonen einzeichnen.

### Simulation

Auf dem Mac läuft die Anwendung mit `GPIO_MODE=simulated`. GPIO-Aktionen werden geloggt und die resultierenden Läufe sind in `watering_runs` und `weather_decisions` nachvollziehbar.

## Lokales Kubernetes mit k3d

Das Projekt ist so angelegt, dass die gleiche Trennung wie auf dem Pi gilt: API mehrfach, Scheduler einmal, Postgres persistent.

```bash
./scripts/deploy-local-k3d.sh
```

Hinweis: Für ein echtes lokales k3d-Deployment müssen die Docker-Images im Cluster verfügbar sein. Das ist derselbe image-basierte Weg, den du später auch auf dem Pi brauchst. Der lokale Scheduler nutzt bewusst `GPIO_MODE=simulated` ohne Device-Mount. Auf dem Pi kommt stattdessen das Pi-spezifische Scheduler-Manifest mit `/dev/gpiochip0` dazu.

## Deployment auf Raspberry Pi mit k3s

### 1. ARM64 Images bauen

```bash
./scripts/build-arm64.sh
```

### 2. Projekt auf den Pi synchronisieren

```bash
./scripts/sync-to-pi.sh pi@<PI_HOST>
```

### 3. Auf dem Pi deployen

```bash
./scripts/deploy-pi.sh
```

Vor dem Pi-Deployment:

- `.env` mit echtem `POSTGRES_PASSWORD` anlegen
- optional `k8s/secret.example.yaml` als Vorlage ansehen, aber nicht direkt verwenden
- Images auf dem Pi oder in einer erreichbaren Registry bereitstellen

## GPIO-Hinweise

- Lokal: `GPIO_MODE=simulated`
- Pi: `GPIO_MODE=real`
- Für den Pi ist in `k8s/scheduler-deployment-pi.yaml` ein `hostPath` für `/dev/gpiochip0` vorbereitet.
- Der `RealGpioAdapter` ist absichtlich nur vorbereitet. Für echte Hardware musst du dort die `libgpiod`-Ansteuerung ergänzen.

## Wetter-API

- Verwendet: [Open-Meteo](https://open-meteo.com/)
- Kein API-Key nötig
- Entscheidung wird je Lauf historisiert
- Fehlerverhalten konfigurierbar:
  - `allow`
  - `deny`

## Datenbankmigrationen

Migrationen laufen lokal und im Cluster über:

```bash
alembic upgrade head
```

Tabellen:

- `zones`
- `schedules`
- `watering_runs`
- `weather_decisions`
- `app_settings`
- `garden_maps`
- `zone_map_shapes`

## Backup-Hinweis

Für den Pi-Betrieb solltest du regelmäßige Postgres-Backups einplanen, zum Beispiel per `pg_dump` auf ein externes Volume oder NAS. Im StatefulSet ist Persistenz nur die erste Schutzschicht, kein Backup.

## Troubleshooting

- Wenn keine Bewässerungen starten, prüfe zuerst `scheduler`-Logs.
- Wenn Läufe mehrfach auftauchen, prüfe Scheduler-Replica-Anzahl und Advisory-Lock-Konfiguration.
- Wenn Open-Meteo nicht erreichbar ist, greift `WEATHER_FAIL_MODE`.
- Wenn du auf dem Pi echte GPIOs nutzt, teste zuerst mit genau einer Zone und Hardware ohne Wasserlast.

## Sinnvolle nächste Schritte

1. `RealGpioAdapter` mit echter `libgpiod`-Ansteuerung implementieren.
2. Optionale Authentifizierung vor die API setzen.
3. DB-Integrationstests per Compose ergänzen.
4. Image-Registry-Workflow für Pi/k3s ergänzen.
5. Optional dedizierten GPIO-Controller-Prozess aus dem Scheduler herauslösen, falls später komplexere Hardwarelogik nötig wird.
