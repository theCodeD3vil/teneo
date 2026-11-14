package com.michael.teneo;

import static com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate.InstallState.STATE_CANCELED;
import static com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED;
import static com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate.InstallState.STATE_FAILED;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.moduleinstall.InstallStatusListener;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Scans QR codes with Google's code scanner from Play services. The scanner
 * shows its own camera screen, so the app needs no camera permission and
 * ships no barcode model.
 */
@CapacitorPlugin(name = "QrScanner")
public class QrScannerPlugin extends Plugin {

    private GmsBarcodeScanner scanner() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build();
        return GmsBarcodeScanning.getClient(getActivity(), options);
    }

    /** Whether Play services already has the scanner downloaded */
    @PluginMethod
    public void isReady(PluginCall call) {
        ModuleInstall.getClient(getContext())
            .areModulesAvailable(scanner())
            .addOnSuccessListener(response -> {
                JSObject result = new JSObject();
                result.put("ready", response.areModulesAvailable());
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject(error.getMessage(), error));
    }

    /** Downloads the scanner, resolving once it can be used */
    @PluginMethod
    public void prepare(PluginCall call) {
        ModuleInstallClient client = ModuleInstall.getClient(getContext());
        // the request and the listener can both report the end
        AtomicBoolean isSettled = new AtomicBoolean(false);

        InstallStatusListener listener = new InstallStatusListener() {
            @Override
            public void onInstallStatusUpdated(ModuleInstallStatusUpdate update) {
                int state = update.getInstallState();
                if (state != STATE_COMPLETED && state != STATE_FAILED && state != STATE_CANCELED) return;
                client.unregisterListener(this);
                if (isSettled.getAndSet(true)) return;
                if (state == STATE_COMPLETED) call.resolve();
                else call.reject("The scanner couldn't be downloaded");
            }
        };

        ModuleInstallRequest request = ModuleInstallRequest.newBuilder().addApi(scanner()).setListener(listener).build();
        client
            .installModules(request)
            .addOnSuccessListener(response -> {
                if (!response.areModulesAlreadyInstalled()) return;
                client.unregisterListener(listener);
                if (!isSettled.getAndSet(true)) call.resolve();
            })
            .addOnFailureListener(error -> {
                client.unregisterListener(listener);
                if (!isSettled.getAndSet(true)) call.reject(error.getMessage(), error);
            });
    }

    /** Resolves with the code's text in `value`, or with no `value` if the user backed out */
    @PluginMethod
    public void scan(PluginCall call) {
        scanner()
            .startScan()
            .addOnSuccessListener(barcode -> {
                JSObject result = new JSObject();
                result.put("value", barcode.getRawValue());
                call.resolve(result);
            })
            .addOnCanceledListener(() -> call.resolve(new JSObject()))
            .addOnFailureListener(error -> call.reject(error.getMessage(), error));
    }
}
