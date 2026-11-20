package com.michael.teneo;

import com.getcapacitor.BridgeActivity;

/**
 * The plugins only one store's build has. Google Play's has none: Play
 * updates the app, so there is no update plugin, and the page, finding none,
 * leaves updates out of Settings (src/main.ts).
 */
final class StorePlugins {

    private StorePlugins() {}

    static void register(BridgeActivity activity) {}
}
