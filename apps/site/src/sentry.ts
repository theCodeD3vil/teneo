import * as Sentry from "@sentry/vue";
import type { App } from "vue";

// Sentry project teneo-site. A DSN only lets clients send events, so it ships
// in the app; VITE_SENTRY_DSN overrides it.
const DSN =
  "https://254f13aa02b9cdc7e72f3154b35ecfec@o4512456625946624.ingest.de.sentry.io/4512456645279824";

// Error reporting for the website, with Session Replay that masks all text
// and media.
export function initSentry(app: App, page: string): void {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN ?? DSN,
    environment: import.meta.env.DEV ? "development" : "production",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    // the site calls only GitHub's API; send it no trace headers
    tracePropagationTargets: [],
    replaysSessionSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    replaysOnErrorSampleRate: 1.0,
    dataCollection: { userInfo: false, urlQueryParams: false },
    initialScope: { tags: { page } },
  });
}
