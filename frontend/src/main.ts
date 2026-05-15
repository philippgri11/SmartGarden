import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { LOCALE_ID } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { RuntimeEffects } from './app/state/runtime/runtime.effects';
import { runtimeFeatureKey, runtimeReducer } from './app/state/runtime/runtime.reducer';

registerLocaleData(localeDe);

bootstrapApplication(AppComponent, {
  providers: [
    { provide: LOCALE_ID, useValue: 'de-DE' },
    provideHttpClient(),
    provideRouter(routes),
    provideStore({ [runtimeFeatureKey]: runtimeReducer }),
    provideEffects([RuntimeEffects]),
  ]
}).catch((err) => console.error(err));
