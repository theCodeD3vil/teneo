import * as Sentry from "@sentry/vue";
import {
  scrubBreadcrumb,
  scrubEvent,
} from "@teneo/shared/privacy/sentry-scrub";
import type { App } from "vue";

// Sentry project teneo-desktop. A DSN only lets clients send events, so it ships
// in the app; VITE_SENTRY_DSN overrides it.
const DSN =
  "https://b0e3220c4c9c8c2dd790f682f0eaed1f@o4512456625946624.ingest.de.sentry.io/4512456645476432";

declare const __APP_VERSION__: string;

// Error reporting for one window. No Session Replay: the windows show
// clipboard contents, and scrubEvent strips copied text from what is sent.
// attachProps is off: a component's props are clipboard items, and @sentry/vue
// would send them whole with any error in it.
export function initSentry(app: App, window: string): void {
  Sentry.init({
    app,
    attachProps: false,
    dsn: import.meta.env.VITE_SENTRY_DSN ?? DSN,
    release: `teneo-desktop@${__APP_VERSION__}`,
    environment: import.meta.env.DEV ? "development" : "production",
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    // the windows only talk to the local backend; send no trace headers
    tracePropagationTargets: [],
    dataCollection: { userInfo: false, urlQueryParams: false },
    initialScope: { tags: { window } },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
