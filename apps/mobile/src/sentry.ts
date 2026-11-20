import * as Sentry from "@sentry/capacitor";
import * as SentryVue from "@sentry/vue";
import {
  scrubBreadcrumb,
  scrubEvent,
} from "@teneo/shared/privacy/sentry-scrub";
import type { App } from "vue";

// Sentry project teneo-mobile. A DSN only lets clients send events, so it ships
// in the app; VITE_SENTRY_DSN overrides it.
const DSN =
  "https://75389f0f2832c8e833f51f4844157a83@o4512456625946624.ingest.de.sentry.io/4512456645607504";

// Error reporting for the app, its WebView and its native Android side. No
// Session Replay: the screens show clipboard contents, and scrubEvent strips
// copied text from what is sent. attachProps is off: a component's props are
// clipboard items, and @sentry/vue would send them whole with any error in it.
// No Sentry logs either: nothing scrubs them.
export function initSentry(app: App): void {
  Sentry.init(
    {
      dsn: import.meta.env.VITE_SENTRY_DSN ?? DSN,
      siblingOptions: {
        vueOptions: { app, attachErrorHandler: false, attachProps: false },
      },
      release: `teneo-mobile@${__APP_VERSION__}`,
      environment: import.meta.env.DEV ? "development" : "production",
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
      // link previews fetch other sites; send them no trace headers
      tracePropagationTargets: [],
      sendDefaultPii: false,
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    },
    SentryVue.init,
  );
}
