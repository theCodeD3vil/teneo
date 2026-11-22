package com.michael.teneo.sync;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import org.json.JSONObject;

/** One encrypted setting for enrollment or a complete, verified snapshot. */
final class TrustedSyncStore {

    private final AtomicFile file;
    private final KeystoreCipher cipher = new KeystoreCipher("teneo-trusted-sync-v1");

    TrustedSyncStore(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "trusted-sync-v1"));
    }

    boolean has() {
        return file.getBaseFile().exists();
    }

    JSONObject read() throws Exception {
        String value = new String(file.readFully(), StandardCharsets.US_ASCII);
        String[] sealed = value.split(":", -1);
        if (sealed.length != 2 || value.length() > 32_768) throw new IllegalStateException("Invalid trusted vault");
        var decoder = Base64.getDecoder();
        byte[] bytes = cipher.decrypt(decoder.decode(sealed[0]), decoder.decode(sealed[1]));
        try {
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    boolean write(JSONObject state) {
        byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream output = null;
        try {
            if (bytes.length > 16_384) return false;
            byte[][] sealed = cipher.encrypt(bytes);
            var encoder = Base64.getEncoder();
            String value = encoder.encodeToString(sealed[0]) + ":" + encoder.encodeToString(sealed[1]);
            output = file.startWrite();
            output.write(value.getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
            file.finishWrite(output);
            output = null;
            // AtomicFile can log (rather than throw) if a rename failed.
            return value.equals(new String(file.readFully(), StandardCharsets.US_ASCII));
        } catch (Exception unavailable) {
            if (output != null) file.failWrite(output);
            return false;
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    void clear() {
        file.delete();
        cipher.forget();
    }
}
