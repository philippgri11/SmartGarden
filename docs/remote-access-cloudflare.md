# Remote Access über Cloudflare

Ziel: Die lokale SmartGarden-Installation bleibt im k3s-Cluster erhalten. Zusätzlich gibt es ein Cloudflare-gehostetes Frontend und einen Cloudflare Tunnel zum `remote-gate` im Cluster. Das Gate kapselt gefährliche Backend-Funktionen, damit Remote-Zugriff nicht automatisch Hardware-/GPIO-Adminzugriff bedeutet.

## Komponenten

- Lokales Frontend im Cluster bleibt unverändert erreichbar.
- Remote-Frontend wird als statische Cloudflare Worker Assets App aus `frontend/dist/irrigation-control-frontend/browser` deployt.
- `cloudflared` läuft als optionales k3s Deployment und baut ausgehend den Tunnel zu Cloudflare auf.
- `remote-gate` läuft als separates k3s Deployment und proxyt nur erlaubte `/api`-Requests zum internen Backend.
- Das bestehende Backend bleibt die einzige Stelle, die Bewässerungslogik und GPIO ausführt.

## Sicherheitsmodell

Das Remote-Gate erlaubt:

- Lesende App-Daten: Runtime, Bereiche, Zeitpläne, Planung, Verlauf, Karten, Settings, GPIO-Events.
- Einzelne Bereiche starten, aber maximal `REMOTE_GATE_MAX_MANUAL_DURATION_MINUTES`.
- Einzelne Bereiche stoppen und `Alles stoppen`.
- Zeitpläne und Karten bearbeiten.
- KI-Zonenassistent und adaptive Regeln.
- System pausieren, Pause aufheben und Wintermodus setzen.

Das Remote-Gate blockt oder entschärft:

- `POST /api/watering/run-all` standardmäßig. Aktivierung nur per `REMOTE_GATE_ALLOW_RUN_ALL=true`.
- `POST /api/system/release-safety-stop` immer remote blockiert.
- `POST /api/zones` und `DELETE /api/zones/{id}` remote blockiert.
- `PUT /api/zones/{id}` entfernt `gpio_chip` und `gpio_line`, bevor der Request ans Backend geht.
- Alle unbekannten API-Pfade werden remote blockiert.

## Cloudflare Setup

Kostenfreie Cloudflare-Bausteine:

- Cloudflare Tunnel
- Cloudflare Access für eine Self-hosted Application
- Cloudflare Pages für das Remote-Frontend

Aktueller Cloudflare-Stand am 19.05.2026:

- Zone `gloriaundphilipp.de` ist aktiv.
- Cloudflare Access ist im Account aktiviert.
- Team-Domain: `bitter-waterfall-8d76.cloudflareaccess.com`
- One-Time-PIN Identity Provider ist vorhanden.
- Remote-Frontend Access App: `smartgarden.gloriaundphilipp.de`
- Remote-API Access App: `smartgarden-api.gloriaundphilipp.de`
- Remote-API Audience: `c08e88defe6a5153fde3daef99bc716ca156140373fb9a063e45650dbc8e5e2d`
- Cloudflare Tunnel: `smartgarden-pi`
- Remote-API DNS: `smartgarden-api.gloriaundphilipp.de` als proxied CNAME auf den Tunnel.
- Remote-Frontend: Cloudflare Pages Projekt `smartgarden-remote-ui`
- Remote-Frontend DNS: `smartgarden.gloriaundphilipp.de` als proxied CNAME auf `smartgarden-remote-ui.pages.dev`.
- GitHub Actions Secret `CLOUDFLARE_API_TOKEN` ist fuer den Pages-Deploy gesetzt.
- Remote-Frontend nutzt im Browser denselben Host mit `/api/*`. Eine Cloudflare Pages Function leitet diese Requests serverseitig an `smartgarden-api.gloriaundphilipp.de` weiter.
- Die Pages Function authentifiziert sich an der API-Access-App mit einem Access Service Token. Dadurch muss der Browser nicht separat gegen `smartgarden-api.gloriaundphilipp.de` eingeloggt werden.
- Der Tunnel prueft Cloudflare Access am Origin mit `originRequest.access.required=true`. Das Remote-Gate macht danach nur noch fachliche Pfad-/Payload-Filter und erzwingt keine zweite JWT-Pruefung im Pi-Cluster.

Der Tunnel-Token wurde geprüft, aber nicht ins Repository geschrieben. Er muss als Kubernetes Secret `CLOUDFLARE_TUNNEL_TOKEN` in `irrigation-secret` gesetzt werden, sobald Zugriff auf den Cluster möglich ist.

Empfohlene Hostnames:

- Remote-Frontend: `smartgarden.gloriaundphilipp.de`
- Remote-API/Tunnel: `smartgarden-api.gloriaundphilipp.de`

Cloudflare Access:

1. Zero Trust / Access im Cloudflare Dashboard aktivieren.
2. Self-hosted Application für `smartgarden.gloriaundphilipp.de` anlegen.
3. Self-hosted Application für `smartgarden-api.gloriaundphilipp.de` anlegen.
4. Allow Policy nur für deine E-Mail-Adresse, mit MFA.
5. Audience Tag der API-App ist als `CLOUDFLARE_ACCESS_AUDIENCE` in `k8s/configmap.yaml` gesetzt.
6. Team Domain ist bereits als `CLOUDFLARE_ACCESS_TEAM_DOMAIN=bitter-waterfall-8d76.cloudflareaccess.com` gesetzt.

Falls die Einrichtung per API laufen soll, braucht der verwendete Cloudflare-Token mindestens Schreibrechte für:

- Cloudflare Access Applications und Policies
- Cloudflare Tunnel
- DNS Records für `gloriaundphilipp.de`
- Cloudflare Pages fuer das Remote-Frontend

Cloudflare Tunnel:

1. Tunnel `smartgarden-pi` ist angelegt.
2. Public Hostname `smartgarden-api.gloriaundphilipp.de` ist auf `http://remote-gate.irrigation.svc.cluster.local:8000` geroutet.
3. Tunnel Token als Kubernetes Secret `CLOUDFLARE_TUNNEL_TOKEN` in `irrigation-secret` setzen.
4. Beim nächsten Deployment wird `k8s/cloudflared-deployment.yaml` angewendet, sobald der Token im Secret existiert.

Remote-Frontend:

1. GitHub Secret `CLOUDFLARE_API_TOKEN` ist mit Pages-Deploy-Rechten gesetzt.
2. GitHub Variable `SMARTGARDEN_REMOTE_API_BASE_URL=https://smartgarden-api.gloriaundphilipp.de/api` ist gesetzt.
3. Auf `main` pusht die CI nach gruenen Backend- und Frontend-Tests das statische Remote-Frontend zu Cloudflare Pages.
4. Feature-Branches werden nicht automatisch zu Cloudflare deployed. Sie koennen bei Bedarf manuell per Workflow/Pages-Deploy veroeffentlicht werden.
5. `runtime-config.js` wird im CI-Build so geschrieben, dass die Remote-App same-origin `/api` nutzt.
6. `frontend/functions/api/[[path]].js` proxyed `/api/*` zur Remote-API und setzt serverseitig die Cloudflare-Access-Service-Token-Header.

## Betriebshinweis

Der Pi ist hardwareseitig scharf. Remote-Tests dürfen nicht über echte Start-Buttons laufen, außer du willst tatsächlich bewässern. Für Smoke-Tests zuerst verwenden:

- `GET /api/runtime`
- `GET /api/schedules/projection`
- `POST /api/watering/stop-all`

Kein Test sollte `POST /api/zones/{id}/start` oder `POST /api/watering/run-all` verwenden, solange Wasser nicht absichtlich laufen soll.
