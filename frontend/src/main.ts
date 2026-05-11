import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { RuntimeEffects } from './app/state/runtime/runtime.effects';
import { runtimeFeatureKey, runtimeReducer } from './app/state/runtime/runtime.reducer';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter(routes),
    provideStore({ [runtimeFeatureKey]: runtimeReducer }),
    provideEffects([RuntimeEffects]),
  ]
}).catch((err) => console.error(err));
