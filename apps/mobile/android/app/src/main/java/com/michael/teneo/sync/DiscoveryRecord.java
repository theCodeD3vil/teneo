package com.michael.teneo.sync;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * What this phone announces on the network, salted so that it says nothing
 * to anyone without the vault's discovery key: packages/sync/src/
 * discovery-record.ts, whose test vector DiscoveryRecordTest checks here too.
 * instance teneo-<salt>; s the salt; vt HMAC(key, "vt|" + salt), 8 bytes;
 * dev the device id XOR HMAC(key, "dev|" + salt), 16 bytes. All hex.
 */
final class DiscoveryRecord {

    private static final SecureRandom RANDOM = new SecureRandom();

    final String instance;
    final Map<String, String> txt;

    private DiscoveryRecord(String instance, Map<String, String> txt) {
        this.instance = instance;
        this.txt = txt;
    }

    static String newSalt() {
        byte[] salt = new byte[8];
        RANDOM.nextBytes(salt);
        return hex(salt);
    }

    static DiscoveryRecord make(String key, String deviceId, String salt) {
        byte[] tag = mac(key, "vt|" + salt);
        byte[] pad = mac(key, "dev|" + salt);
        byte[] id = fromHex(deviceId);
        byte[] masked = new byte[16];
        for (int i = 0; i < 16; i++) masked[i] = (byte) (id[i] ^ pad[i]);
        Map<String, String> txt = new HashMap<>();
        txt.put("s", salt);
        txt.put("vt", hex(java.util.Arrays.copyOf(tag, 8)));
        txt.put("dev", hex(masked));
        return new DiscoveryRecord("teneo-" + salt, txt);
    }

    /** The id of the device that announced `txt`, or null when it is no device of this vault */
    static String read(String key, Map<String, String> txt) {
        String salt = txt.get("s");
        String vt = txt.get("vt");
        String dev = txt.get("dev");
        if (salt == null || !salt.matches("[0-9a-f]{16}") || vt == null || !vt.matches("[0-9a-f]{16}") || dev == null || !dev.matches("[0-9a-f]{32}")) {
            return null;
        }
        byte[] expected = java.util.Arrays.copyOf(mac(key, "vt|" + salt), 8);
        if (!MessageDigest.isEqual(expected, fromHex(vt))) return null;
        byte[] pad = mac(key, "dev|" + salt);
        byte[] masked = fromHex(dev);
        byte[] id = new byte[16];
        for (int i = 0; i < 16; i++) id[i] = (byte) (masked[i] ^ pad[i]);
        return hex(id);
    }

    private static byte[] mac(String key, String label) {
        try {
            Mac hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(fromHex(key), "HmacSHA256"));
            return hmac.doFinal(label.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) text.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return text.toString();
    }

    static byte[] fromHex(String text) {
        byte[] bytes = new byte[text.length() / 2];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }
}
