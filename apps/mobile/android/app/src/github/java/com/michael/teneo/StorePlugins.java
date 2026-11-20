package com.michael.teneo;

import com.getcapacitor.BridgeActivity;
import com.michael.teneo.updates.UpdatePlugin;

/**
 * The plugins only one store's build has. The build released on GitHub
 * updates itself from there (updates/UpdatePlugin.java).
 */
final class StorePlugins {

    private StorePlugins() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(UpdatePlugin.class);
    }
}
