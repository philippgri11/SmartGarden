# Bewaesserungsmodell-Settings

Diese Settings kalibrieren die automatische Laufzeitberechnung fuer Zonenprofile. Sie gelten fuer adaptive Regeln und fuer feste Zeitplaene, wenn fuer die Zone ein Bewaesserungsprofil hinterlegt ist.

Die Werte liegen in der Kubernetes ConfigMap `irrigation-config` und koennen ohne Code-Aenderung angepasst werden. Nach einer Aenderung muessen Backend und Scheduler neu gestartet werden, damit die Settings neu geladen werden.

| Setting | Default | Wirkung |
| --- | ---: | --- |
| `IRRIGATION_MODEL_NEUTRAL_TEMPERATURE_C` | `22.0` | Temperatur, ab der Hitze neutral bewertet wird. Darunter sinkt, darueber steigt der Wasserbedarf. |
| `IRRIGATION_MODEL_HEAT_PRESSURE_SPAN_C` | `14.0` | Temperaturspanne bis zum vollen Hitzedruck. Bei `22 + 14 = 36` Grad ist der Hitzedruck gedeckelt. |
| `IRRIGATION_MODEL_TEMPERATURE_INFLUENCE` | `0.35` | Staerke, mit der Temperatur die Laufzeit beeinflusst. Hoeher bedeutet mehr Laufzeit an heissen Tagen. |
| `IRRIGATION_MODEL_SUN_INFLUENCE` | `0.4` | Staerke, mit der geringe Bewoelkung die Laufzeit beeinflusst. Hoeher bedeutet mehr Laufzeit bei viel Sonne. |
| `IRRIGATION_MODEL_FORECAST_RAIN_WEIGHT` | `0.5` | Anteil, mit dem erwarteter Regen in den naechsten 24 Stunden angerechnet wird. `0.5` bedeutet: Forecast-Regen zaehlt halb so stark wie gemessener Regen. |
| `IRRIGATION_MODEL_MIN_DURATION_MULTIPLIER` | `0.35` | Untere Grenze fuer automatische Laufzeitkuerzung. Ein geplanter Lauf faellt damit normalerweise nicht unter 35 Prozent, ausser er wird komplett uebersprungen. |
| `IRRIGATION_MODEL_MAX_DURATION_MULTIPLIER` | `1.6` | Obere Grenze fuer automatische Laufzeitverlaengerung. Ein geplanter Lauf wird maximal auf 160 Prozent skaliert. |
| `IRRIGATION_MODEL_SKIP_NET_NEED_THRESHOLD_MM` | `0.6` | Wenn der berechnete Netto-Wasserbedarf darunter liegt, darf ein automatischer Lauf uebersprungen werden. Zonen mit Trockenstress-Schutz werden nicht dadurch uebersprungen. |

Weitere interne Faktoren wie Strategie, Trocknungsgeschwindigkeit, Topffaktor und Sicherheitsgrenzen sind im Domain-Modell benannt, aber nicht als Betriebssettings freigegeben. Sie sind bewusst stabil gehalten, damit die Anlage nicht durch zu viele gleichzeitige Stellschrauben schwer vorhersagbar wird.
