from conftest import create_zone_payload


def test_zone_assistant_suggest_endpoint(client) -> None:
    response = client.post('/api/zones/assistant/suggest', json={'description': 'Das ist ein Hochbeet mit Tomaten und Paprika. Es steht fast den ganzen Tag in der Sonne. Regen kommt gut ran, aber die Erde trocknet schnell aus.'})
    assert response.status_code == 200
    payload = response.json()
    assert payload['profile']['zoneType'] == 'raised_bed'
    assert payload['profile']['plantType'] == 'vegetables'
    assert payload['profile']['dryingSpeed'] == 'fast'
    assert payload['explanation']


def test_zone_assistant_adjust_endpoint_returns_diff(client) -> None:
    zone = client.post('/api/zones', json={
        **create_zone_payload('Tomatenbeet', 30),
        'zone_profile_description': 'Hochbeet mit Gemüse',
        'irrigation_profile': {
            'zoneType': 'raised_bed', 'plantType': 'vegetables', 'sunExposure': 'sunny', 'rainExposure': 'high',
            'rainEffectiveness': 0.7, 'waterNeedLevel': 'medium', 'baseWaterNeedMmPerDay': 3.5,
            'temperatureSensitivity': 1.1, 'sunSensitivity': 1.1, 'containerFactor': 1.3, 'dryingSpeed': 'normal',
            'wateringFrequencyPreference': 'normal', 'preferredTimeWindow': 'early_morning', 'strategy': 'balanced',
            'riskProfile': 'balanced', 'explanation': 'Basis'
        }
    }).json()

    response = client.post(f"/api/zones/{zone['id']}/assistant/adjust", json={'instruction': 'Die Erde trocknet viel schneller aus als gedacht und die Pflanzen stehen den ganzen Nachmittag in der Sonne.'})
    assert response.status_code == 200
    payload = response.json()
    assert payload['profile']['baseWaterNeedMmPerDay'] > 3.5
    assert payload['diff']


def test_zone_roundtrip_includes_irrigation_profile(client) -> None:
    created = client.post('/api/zones', json={
        **create_zone_payload('Terrasse', 31),
        'zone_profile_description': 'Kübel auf der Südterrasse',
        'irrigation_profile': {
            'zoneType': 'container', 'plantType': 'flowers', 'sunExposure': 'full_sun', 'rainExposure': 'none',
            'rainEffectiveness': 0.1, 'waterNeedLevel': 'high', 'baseWaterNeedMmPerDay': 4.8,
            'temperatureSensitivity': 1.6, 'sunSensitivity': 1.7, 'containerFactor': 1.8, 'dryingSpeed': 'fast',
            'wateringFrequencyPreference': 'frequent_short', 'preferredTimeWindow': 'morning_and_evening', 'strategy': 'balanced',
            'riskProfile': 'avoid_drought_stress', 'explanation': 'Kübel trocknen schnell aus.'
        }
    })
    assert created.status_code == 201
    zone = created.json()
    assert zone['zone_profile_description'] == 'Kübel auf der Südterrasse'
    assert zone['irrigation_profile']['zoneType'] == 'container'


def test_suggest_adaptive_plan_endpoint_requires_user_approval_payload(client) -> None:
    response = client.post(
        '/api/zones/assistant/adaptive-plan',
        json={
            'description': 'Rasen volle Sonne, Sprenger, Regen kommt vollständig an.',
            'max_duration_minutes': 30,
            'profile': {
                'zoneType': 'lawn', 'plantType': 'grass', 'sunExposure': 'full_sun', 'rainExposure': 'full',
                'rainEffectiveness': 0.95, 'waterNeedLevel': 'high', 'baseWaterNeedMmPerDay': 4.2,
                'temperatureSensitivity': 1.2, 'sunSensitivity': 1.5, 'containerFactor': 1.0, 'dryingSpeed': 'normal',
                'wateringFrequencyPreference': 'rare_deep', 'preferredTimeWindow': 'early_morning', 'strategy': 'balanced',
                'riskProfile': 'balanced', 'explanation': 'Testprofil'
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['plan']['avoidMidday'] is True
    assert payload['plan']['preferredTimeWindows'] == ['early_morning']
    assert payload['plan']['rules']


def test_zone_roundtrip_includes_adaptive_plan_without_enabling_static_schedules(client) -> None:
    created = client.post('/api/zones', json={
        **create_zone_payload('Adaptive Terrasse', 32),
        'scheduling_mode': 'adaptive',
        'irrigation_profile': {
            'zoneType': 'container', 'plantType': 'flowers', 'sunExposure': 'full_sun', 'rainExposure': 'none',
            'rainEffectiveness': 0.1, 'waterNeedLevel': 'high', 'baseWaterNeedMmPerDay': 4.8,
            'temperatureSensitivity': 1.6, 'sunSensitivity': 1.7, 'containerFactor': 1.8, 'dryingSpeed': 'fast',
            'wateringFrequencyPreference': 'frequent_short', 'preferredTimeWindow': 'morning_and_evening', 'strategy': 'balanced',
            'riskProfile': 'avoid_drought_stress', 'explanation': 'Kübel trocknen schnell aus.'
        },
        'adaptive_irrigation_plan': {
            'irrigationMethod': 'drip',
            'preferredTimeWindows': ['morning_and_evening'],
            'avoidMidday': False,
            'allowSecondDailyRun': True,
            'minIntervalHours': 8,
            'baseDurationMinutes': 6,
            'minDurationMinutes': 2,
            'maxDurationMinutes': 12,
            'rainSkipThresholdMm': 2.0,
            'rainDelayThresholdMm': 1.0,
            'heatThresholdC': 26.0,
            'highNeedThresholdMm': 2.0,
            'rules': ['Bei Hitze morgens und abends kurz giessen.'],
            'explanation': 'Testplan',
        },
    })

    assert created.status_code == 201
    zone = created.json()
    assert zone['scheduling_mode'] == 'adaptive'
    assert zone['adaptive_irrigation_plan']['allowSecondDailyRun'] is True


def test_transcription_endpoint_requires_openai_key(client) -> None:
    response = client.post(
        '/api/zones/assistant/transcribe',
        json={'audio_base64': 'bm90LXJlYWwtYXVkaW8=', 'filename': 'test.webm', 'mime_type': 'audio/webm'},
    )

    assert response.status_code == 400
