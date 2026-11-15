package com.michael.teneo.sync;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class VaultKeyStoreTest {

    /** Reversible stand-in for the Keystore: XOR with a key it holds */
    static final class FakeCipher implements VaultKeyStore.Cipher {

        byte mask = 0x5a;
        boolean failEncrypt;
        boolean failDecrypt;
        boolean forgotten;
        byte[] lastPlain;

        @Override
        public byte[][] encrypt(byte[] plain) throws Exception {
            if (failEncrypt) throw new Exception("keystore unavailable");
            lastPlain = plain.clone();
            byte[] sealed = new byte[plain.length];
            for (int i = 0; i < plain.length; i++) sealed[i] = (byte) (plain[i] ^ mask);
            return new byte[][] { new byte[] { 1, 2, 3 }, sealed };
        }

        @Override
        public byte[] decrypt(byte[] nonce, byte[] sealed) throws Exception {
            if (failDecrypt || forgotten) throw new Exception("key gone");
            if (!Arrays.equals(nonce, new byte[] { 1, 2, 3 })) throw new Exception("wrong nonce");
            byte[] plain = new byte[sealed.length];
            for (int i = 0; i < sealed.length; i++) plain[i] = (byte) (sealed[i] ^ mask);
            return plain;
        }

        @Override
        public void forget() {
            forgotten = true;
        }
    }

    static final class FakeStorage implements VaultKeyStore.Storage {

        final Map<String, String> values = new HashMap<>();
        boolean failPut;

        @Override
        public String get(String name) {
            return values.get(name);
        }

        @Override
        public boolean put(String name, String value) {
            if (failPut) return false;
            values.put(name, value);
            return true;
        }

        @Override
        public boolean remove(String name) {
            values.remove(name);
            return true;
        }
    }

    private final FakeCipher cipher = new FakeCipher();
    private final FakeStorage storage = new FakeStorage();
    private final VaultKeyStore store = new VaultKeyStore(storage, cipher);

    private static byte[] key() {
        byte[] key = new byte[VaultKeyStore.KEY_LENGTH];
        for (int i = 0; i < key.length; i++) key[i] = (byte) (i * 7 + 1);
        return key;
    }

    @Test
    public void aSavedKeyReadsBack() {
        assertFalse(store.has());
        assertTrue(store.save(key()));
        assertTrue(store.has());
        VaultKeyStore.Read read = store.read();
        assertFalse(read.unreadable);
        assertArrayEquals(key(), read.key);
    }

    @Test
    public void whatIsStoredIsNotTheKey() {
        store.save(key());
        String stored = storage.values.get(VaultKeyStore.NAME);
        assertTrue(stored.startsWith("v1:"));
        String plainBase64 = java.util.Base64.getEncoder().encodeToString(key());
        assertFalse(stored.contains(plainBase64));
    }

    @Test
    public void nothingStoredReadsAsNoKeyNotAsAProblem() {
        VaultKeyStore.Read read = store.read();
        assertNull(read.key);
        assertFalse(read.unreadable);
    }

    @Test
    public void aKeyOfTheWrongLengthIsRefused() {
        assertFalse(store.save(new byte[16]));
        assertFalse(store.save(new byte[33]));
        assertFalse(store.save(null));
        assertFalse(store.has());
    }

    @Test
    public void aCipherFailureStoresNothing() {
        cipher.failEncrypt = true;
        assertFalse(store.save(key()));
        assertFalse(store.has());
    }

    @Test
    public void aStorageFailureStoresNothing() {
        storage.failPut = true;
        assertFalse(store.save(key()));
        assertFalse(store.has());
    }

    @Test
    public void aKeyTheKeystoreCannotOpenIsUnreadable() {
        store.save(key());
        cipher.failDecrypt = true;
        VaultKeyStore.Read read = store.read();
        assertNull(read.key);
        assertTrue(read.unreadable);
        assertTrue("still paired, so the user can see it and unpair", store.has());
    }

    @Test
    public void garbledStorageIsUnreadable() {
        for (String garbled : new String[] { "", "v1", "v1:AQID", "v2:AQID:AAAA", "v1:%%%:AAAA", "v1:AQID:AAAA:extra" }) {
            storage.values.put(VaultKeyStore.NAME, garbled);
            VaultKeyStore.Read read = store.read();
            assertNull(garbled, read.key);
            assertTrue(garbled, read.unreadable);
        }
    }

    @Test
    public void aDecryptedKeyOfTheWrongLengthIsUnreadable() {
        storage.values.put(VaultKeyStore.NAME, "v1:AQID:AAAA");
        VaultKeyStore.Read read = store.read();
        assertNull(read.key);
        assertTrue(read.unreadable);
    }

    @Test
    public void forgettingRemovesTheStoredKeyAndTheKeystoreKey() {
        store.save(key());
        store.forget();
        assertFalse(store.has());
        assertTrue(cipher.forgotten);
        assertEquals(0, storage.values.size());
        VaultKeyStore.Read read = store.read();
        assertNull(read.key);
        assertFalse(read.unreadable);
    }

    @Test
    public void savingAgainReplacesTheKey() {
        store.save(key());
        byte[] other = new byte[VaultKeyStore.KEY_LENGTH];
        Arrays.fill(other, (byte) 9);
        assertTrue(store.save(other));
        assertArrayEquals(other, store.read().key);
    }
}
