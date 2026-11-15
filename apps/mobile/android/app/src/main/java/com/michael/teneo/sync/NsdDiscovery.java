package com.michael.teneo.sync;

import android.annotation.TargetApi;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.util.Log;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Bonjour for the phone, through Android's NsdManager: announces this device
 * and looks for the others of its vault, the way the Mac does with `dns-sd`
 * (discovery-macos.ts). The service type is _teneo-sync._tcp, the instance is
 * named teneo-<first 12 hex digits of the device id>, and its TXT records are
 * vt=<vault tag> and dev=<device id>. A service with another tag is another
 * vault's and is ignored; so is this device's own.
 *
 * Every callback is moved to the handler's thread, so none of the state
 * below needs a lock. `restart` is for when the network changed.
 */
final class NsdDiscovery {

    interface Listener {
        /** A device of this vault was found, or found again at a new address */
        void onDevice(String deviceId, List<String> addresses, int port);
    }

    private static final String TAG = "TeneoSync";
    private static final String SERVICE_TYPE = "_teneo-sync._tcp";
    private static final Pattern DEVICE_ID = Pattern.compile("^[0-9a-f]{32}$");

    /** Browsing or announcing that ended by itself is started again after this */
    private static final long RETRY_MS = 5_000;
    private static final int RESOLVE_ATTEMPTS = 3;
    private static final long RESOLVE_TIMEOUT_MS = 4_000;
    /** How long to wait for the old announcement to be withdrawn before a new one */
    private static final long WITHDRAW_MS = 1_500;
    /** Every instance in view is resolved again this often: a device that
     *  moved to another address or port without leaving is not found again
     *  by the browse, and one that could not be resolved gets another try */
    private static final long REFRESH_MS = 30_000;

    private final NsdManager nsd;
    private final Handler handler;
    private final Predicate<String> isLocal;
    private final Listener listener;

    // what start() was given, kept for restart()
    private String tag;
    private String deviceId;
    private int port;

    /** Bumped by every start and stop: callbacks of an earlier one are let go */
    private int generation;
    private NsdManager.RegistrationListener registration;
    private NsdManager.DiscoveryListener discovery;
    /** Browse reports an instance once for each network it is on */
    private final Set<String> handled = new HashSet<>();
    /** Every instance the browse has in view, by name, to resolve again */
    private final Map<String, NsdServiceInfo> inView = new HashMap<>();
    /** Where each device was last told to be, so only a move is told again */
    private final Map<String, String> told = new HashMap<>();
    private final ArrayDeque<Pending> resolveQueue = new ArrayDeque<>();
    private boolean resolving;
    /** Names with a resolve under way, first or refresh */
    private final Set<String> resolvingNow = new HashSet<>();
    private final List<NsdManager.ServiceInfoCallback> infoCallbacks = new ArrayList<>();

    private static final class Pending {

        final NsdServiceInfo info;
        final int attempt;

        Pending(NsdServiceInfo info, int attempt) {
            this.info = info;
            this.attempt = attempt;
        }
    }

    NsdDiscovery(Context context, Handler handler, Predicate<String> isLocal, Listener listener) {
        this.nsd = context.getSystemService(NsdManager.class);
        this.handler = handler;
        this.isLocal = isLocal;
        this.listener = listener;
    }

    /** Announces on `port` (not when it is negative: nothing is listening) and browses */
    void start(String tag, String deviceId, int port) {
        this.tag = tag;
        this.deviceId = deviceId;
        this.port = port;
        begin();
    }

    /** Announce and look again, after the network changed */
    void restart() {
        if (tag == null) return;
        int restarting = end();
        // a new announcement under the same name straight after the old one is
        // withdrawn is renamed "(2)", so give the withdrawal a moment
        handler.postDelayed(
            () -> {
                if (generation == restarting && tag != null) begin();
            },
            WITHDRAW_MS
        );
    }

    void stop() {
        tag = null;
        end();
    }

    // --- start and end

    private void begin() {
        int mine = ++generation;
        handled.clear();
        inView.clear();
        told.clear();
        if (port > 0) announce(mine);
        browse(mine);
        handler.postDelayed(() -> refresh(mine), REFRESH_MS);
    }

    /** Resolve again whatever is in view and not being resolved right now */
    private void refresh(int mine) {
        if (generation != mine) return;
        for (Map.Entry<String, NsdServiceInfo> seen : new ArrayList<>(inView.entrySet())) {
            // one whose resolve is still running is left to it
            if (resolvingNow.add(seen.getKey())) resolve(mine, seen.getValue(), RESOLVE_ATTEMPTS);
        }
        handler.postDelayed(() -> refresh(mine), REFRESH_MS);
    }

    /** Withdraws everything, and returns the generation this leaves behind */
    private int end() {
        int mine = ++generation;
        resolveQueue.clear();
        resolving = false;
        resolvingNow.clear();
        if (Build.VERSION.SDK_INT >= 34) unregisterInfoCallbacks();
        infoCallbacks.clear();
        if (registration != null) {
            try {
                nsd.unregisterService(registration);
            } catch (RuntimeException ignored) {
                // not registered
            }
            registration = null;
        }
        if (discovery != null) {
            try {
                nsd.stopServiceDiscovery(discovery);
            } catch (RuntimeException ignored) {
                // not running
            }
            discovery = null;
        }
        return mine;
    }

    @TargetApi(34)
    private void unregisterInfoCallbacks() {
        for (NsdManager.ServiceInfoCallback callback : infoCallbacks) {
            try {
                nsd.unregisterServiceInfoCallback(callback);
            } catch (RuntimeException ignored) {
                // never registered, or already gone
            }
        }
    }

    // --- announcing

    private String instanceName() {
        return "teneo-" + deviceId.substring(0, 12);
    }

    private void announce(int mine) {
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(instanceName());
        info.setServiceType(SERVICE_TYPE);
        info.setPort(port);
        info.setAttribute("vt", tag);
        info.setAttribute("dev", deviceId);
        NsdManager.RegistrationListener listener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo registered) {
                handler.post(() -> {
                    if (generation == mine) Log.i(TAG, "announced as " + registered.getServiceName() + " on port " + port);
                });
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo failed, int errorCode) {
                handler.post(() -> {
                    Log.w(TAG, "could not announce: error " + errorCode);
                    retryLater(mine, () -> announce(mine));
                });
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo unregistered) {}

            @Override
            public void onUnregistrationFailed(NsdServiceInfo failed, int errorCode) {
                Log.w(TAG, "could not withdraw the announcement: error " + errorCode);
            }
        };
        registration = listener;
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (RuntimeException error) {
            Log.w(TAG, "could not announce", error);
            registration = null;
            retryLater(mine, () -> announce(mine));
        }
    }

    private void retryLater(int mine, Runnable again) {
        handler.postDelayed(
            () -> {
                if (generation == mine && tag != null) again.run();
            },
            RETRY_MS
        );
    }

    // --- browsing

    private void browse(int mine) {
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override
            public void onServiceFound(NsdServiceInfo found) {
                handler.post(() -> {
                    if (generation != mine) return;
                    String name = found.getServiceName();
                    if (isOwn(name)) return;
                    inView.put(name, found);
                    if (!handled.add(name)) return;
                    resolvingNow.add(name);
                    resolve(mine, found, 1);
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo lost) {
                // it may come back, at another address
                handler.post(() -> {
                    if (generation != mine) return;
                    String name = lost.getServiceName();
                    handled.remove(name);
                    inView.remove(name);
                    resolvingNow.remove(name);
                    // found again later, it is told again even at the same place
                    told.keySet().removeIf(device -> name.startsWith("teneo-" + device.substring(0, 12)));
                });
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                handler.post(() -> {
                    Log.w(TAG, "could not browse: error " + errorCode);
                    // a browse of an earlier start: the one running now is not its to drop
                    if (generation != mine) return;
                    discovery = null;
                    retryLater(mine, () -> browse(mine));
                });
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.w(TAG, "could not stop browsing: error " + errorCode);
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {}

            @Override
            public void onDiscoveryStopped(String serviceType) {}
        };
        discovery = listener;
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (RuntimeException error) {
            Log.w(TAG, "could not browse", error);
            discovery = null;
            retryLater(mine, () -> browse(mine));
        }
    }

    private boolean isOwn(String name) {
        // Android adds " (2)" when a name is taken
        return name.equals(instanceName()) || name.startsWith(instanceName() + " (");
    }

    // --- resolving: where an instance can be reached, and its TXT records

    private void resolve(int mine, NsdServiceInfo found, int attempt) {
        if (Build.VERSION.SDK_INT >= 34) {
            resolveWithCallback(mine, found, attempt);
        } else {
            resolveQueue.add(new Pending(found, attempt));
            resolveNext(mine);
        }
    }

    /** Android 14 and later: any number at once, no waiting in line */
    @TargetApi(34)
    private void resolveWithCallback(int mine, NsdServiceInfo found, int attempt) {
        final NsdManager.ServiceInfoCallback[] self = new NsdManager.ServiceInfoCallback[1];
        final boolean[] done = { false };
        Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            infoCallbacks.remove(self[0]);
            try {
                nsd.unregisterServiceInfoCallback(self[0]);
            } catch (RuntimeException ignored) {
                // already unregistered
            }
        };
        self[0] = new NsdManager.ServiceInfoCallback() {
            @Override
            public void onServiceInfoCallbackRegistrationFailed(int errorCode) {
                handler.post(() -> {
                    done[0] = true;
                    infoCallbacks.remove(self[0]);
                    gaveUpOn(mine, found, attempt, "registration failed " + errorCode);
                });
            }

            @Override
            public void onServiceUpdated(NsdServiceInfo updated) {
                handler.post(() -> {
                    if (done[0] || generation != mine) return;
                    List<String> addresses = new ArrayList<>();
                    for (InetAddress address : updated.getHostAddresses()) addresses.add(address.getHostAddress());
                    // the addresses may follow the first update: wait for one
                    if (addresses.isEmpty()) return;
                    finish.run();
                    if (!deliver(mine, updated.getServiceName(), updated.getAttributes(), addresses, updated.getPort())) {
                        gaveUpOn(mine, found, attempt, "no usable address");
                    }
                });
            }

            @Override
            public void onServiceLost() {
                handler.post(() -> {
                    finish.run();
                    resolvingNow.remove(found.getServiceName());
                });
            }

            @Override
            public void onServiceInfoCallbackUnregistered() {}
        };
        infoCallbacks.add(self[0]);
        try {
            nsd.registerServiceInfoCallback(found, handler::post, self[0]);
        } catch (RuntimeException error) {
            infoCallbacks.remove(self[0]);
            gaveUpOn(mine, found, attempt, String.valueOf(error));
            return;
        }
        handler.postDelayed(
            () -> {
                if (done[0]) return;
                finish.run();
                gaveUpOn(mine, found, attempt, "timed out");
            },
            RESOLVE_TIMEOUT_MS
        );
    }

    /** Android 13 and earlier: resolveService takes one at a time */
    @SuppressWarnings("deprecation")
    private void resolveNext(int mine) {
        if (resolving || resolveQueue.isEmpty() || generation != mine) return;
        resolving = true;
        Pending pending = resolveQueue.poll();
        NsdServiceInfo found = pending.info;
        int attempt = pending.attempt;
        final boolean[] done = { false };
        Runnable next = () -> {
            if (done[0]) return;
            done[0] = true;
            resolving = false;
            resolveNext(mine);
        };
        NsdManager.ResolveListener listener = new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo failed, int errorCode) {
                handler.post(() -> {
                    if (done[0]) return;
                    next.run();
                    gaveUpOn(mine, found, attempt, "error " + errorCode);
                });
            }

            @Override
            public void onServiceResolved(NsdServiceInfo resolved) {
                handler.post(() -> {
                    if (done[0]) return;
                    next.run();
                    List<String> addresses = new ArrayList<>();
                    if (resolved.getHost() != null) addresses.add(resolved.getHost().getHostAddress());
                    if (generation == mine && !deliver(mine, resolved.getServiceName(), resolved.getAttributes(), addresses, resolved.getPort())) {
                        gaveUpOn(mine, found, attempt, "no usable address");
                    }
                });
            }
        };
        try {
            nsd.resolveService(found, listener);
        } catch (RuntimeException error) {
            next.run();
            gaveUpOn(mine, found, attempt, String.valueOf(error));
            return;
        }
        handler.postDelayed(
            () -> {
                if (done[0]) return;
                next.run();
                gaveUpOn(mine, found, attempt, "timed out");
            },
            RESOLVE_TIMEOUT_MS
        );
    }

    /** A resolve failed: try again a few times, then forget it until it is found again */
    private void gaveUpOn(int mine, NsdServiceInfo found, int attempt, String why) {
        if (generation != mine) return;
        if (attempt < RESOLVE_ATTEMPTS) {
            handler.postDelayed(
                () -> {
                    if (generation == mine) resolve(mine, found, attempt + 1);
                },
                1_000
            );
        } else {
            Log.i(TAG, "could not resolve " + found.getServiceName() + ": " + why);
            handled.remove(found.getServiceName());
            resolvingNow.remove(found.getServiceName());
        }
    }

    /** Hands a device of this vault to the listener. False when what was found
     *  can't be reached; true also for a service of another vault or this
     *  device, which are not ours and not to be tried again. */
    private boolean deliver(int mine, String name, Map<String, byte[]> attributes, List<String> found, int servicePort) {
        resolvingNow.remove(name);
        String vaultTag = text(attributes.get("vt"));
        String device = text(attributes.get("dev"));
        if (!tag.equals(vaultTag) || device == null || !DEVICE_ID.matcher(device).matches() || device.equals(deviceId)) return true;

        List<String> addresses = new ArrayList<>();
        for (String address : found) {
            // IPv4 only, as the Mac announces and listens; and local ones only
            if (address != null && !address.contains(":") && isLocal.test(address)) addresses.add(address);
        }
        if (addresses.isEmpty() || servicePort < 1) return false;
        // a refresh that finds the device where it was says nothing: telling
        // it again would reset the wait after a failed dial
        String where = addresses + ":" + servicePort;
        if (where.equals(told.put(device, where))) return true;
        listener.onDevice(device, addresses, servicePort);
        return true;
    }

    private static String text(byte[] bytes) {
        return bytes == null ? null : new String(bytes, StandardCharsets.UTF_8);
    }
}
