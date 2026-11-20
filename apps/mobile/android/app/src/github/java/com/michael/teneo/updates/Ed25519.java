package com.michael.teneo.updates;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;

/**
 * Ed25519 signature verification (RFC 8032, section 5.1.7), for the signed
 * update manifest. Android's own Ed25519 isn't on every version this app
 * runs on, and verifying needs no secret, so plain BigInteger arithmetic is
 * enough: it runs once per update check. Ed25519Test checks it against the
 * JDK's Ed25519 and RFC 8032's test vectors.
 */
final class Ed25519 {

    private static final BigInteger P = BigInteger.ONE.shiftLeft(255).subtract(BigInteger.valueOf(19));
    /** The order of the base point */
    private static final BigInteger L = BigInteger.ONE.shiftLeft(252).add(new BigInteger("27742317777372353535851937790883648493"));
    private static final BigInteger D = BigInteger.valueOf(-121665).multiply(BigInteger.valueOf(121666).modInverse(P)).mod(P);
    private static final BigInteger TWO_D = D.shiftLeft(1).mod(P);
    private static final BigInteger SQRT_M1 = BigInteger.valueOf(2).modPow(P.subtract(BigInteger.ONE).shiftRight(2), P);
    private static final BigInteger SQRT_EXPONENT = P.subtract(BigInteger.valueOf(5)).shiftRight(3);

    /** A point in extended coordinates: x = X/Z, y = Y/Z, x*y = T/Z */
    private static final class Point {

        final BigInteger x;
        final BigInteger y;
        final BigInteger z;
        final BigInteger t;

        Point(BigInteger x, BigInteger y, BigInteger z, BigInteger t) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.t = t;
        }
    }

    private static final Point IDENTITY = new Point(BigInteger.ZERO, BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO);
    private static final Point BASE;

    static {
        BigInteger y = BigInteger.valueOf(4).multiply(BigInteger.valueOf(5).modInverse(P)).mod(P);
        BigInteger x = recoverX(y, false);
        BASE = new Point(x, y, BigInteger.ONE, x.multiply(y).mod(P));
    }

    private Ed25519() {}

    /** Whether `signature` is `publicKey`'s signature of `message` */
    static boolean verify(byte[] publicKey, byte[] message, byte[] signature) {
        if (publicKey == null || publicKey.length != 32 || message == null || signature == null || signature.length != 64) return false;
        Point a = decode(publicKey);
        byte[] r = Arrays.copyOfRange(signature, 0, 32);
        BigInteger s = fromLittleEndian(Arrays.copyOfRange(signature, 32, 64));
        // a non-canonical S would make one signature many
        if (a == null || decode(r) == null || s.compareTo(L) >= 0) return false;
        MessageDigest sha512;
        try {
            sha512 = MessageDigest.getInstance("SHA-512");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
        sha512.update(r);
        sha512.update(publicKey);
        sha512.update(message);
        BigInteger k = fromLittleEndian(sha512.digest()).mod(L);
        // [S]B = R + [k]A, checked as [S]B - [k]A encoding to R itself
        Point check = add(multiply(s, BASE), negate(multiply(k, a)));
        return MessageDigest.isEqual(encode(check), r);
    }

    private static Point add(Point p, Point q) {
        BigInteger a = p.y.subtract(p.x).multiply(q.y.subtract(q.x)).mod(P);
        BigInteger b = p.y.add(p.x).multiply(q.y.add(q.x)).mod(P);
        BigInteger c = p.t.multiply(TWO_D).multiply(q.t).mod(P);
        BigInteger d = p.z.shiftLeft(1).multiply(q.z).mod(P);
        BigInteger e = b.subtract(a);
        BigInteger f = d.subtract(c);
        BigInteger g = d.add(c);
        BigInteger h = b.add(a);
        return new Point(e.multiply(f).mod(P), g.multiply(h).mod(P), f.multiply(g).mod(P), e.multiply(h).mod(P));
    }

    private static Point negate(Point p) {
        return new Point(P.subtract(p.x).mod(P), p.y, p.z, P.subtract(p.t).mod(P));
    }

    private static Point multiply(BigInteger scalar, Point p) {
        Point result = IDENTITY;
        for (int bit = scalar.bitLength() - 1; bit >= 0; bit--) {
            result = add(result, result);
            if (scalar.testBit(bit)) result = add(result, p);
        }
        return result;
    }

    private static byte[] encode(Point p) {
        BigInteger inverse = p.z.modInverse(P);
        BigInteger x = p.x.multiply(inverse).mod(P);
        BigInteger y = p.y.multiply(inverse).mod(P);
        byte[] bytes = toLittleEndian(y);
        if (x.testBit(0)) bytes[31] |= (byte) 0x80;
        return bytes;
    }

    /** The point 32 bytes encode, or null when they encode none */
    private static Point decode(byte[] encoded) {
        byte[] bytes = encoded.clone();
        boolean negative = (bytes[31] & 0x80) != 0;
        bytes[31] &= 0x7f;
        BigInteger y = fromLittleEndian(bytes);
        if (y.compareTo(P) >= 0) return null;
        BigInteger x = recoverX(y, negative);
        return x == null ? null : new Point(x, y, BigInteger.ONE, x.multiply(y).mod(P));
    }

    /** x from y and its sign (RFC 8032, 5.1.3), or null when y is on no point */
    private static BigInteger recoverX(BigInteger y, boolean negative) {
        BigInteger y2 = y.multiply(y).mod(P);
        BigInteger u = y2.subtract(BigInteger.ONE).mod(P);
        BigInteger v = D.multiply(y2).add(BigInteger.ONE).mod(P);
        BigInteger v3 = v.multiply(v).multiply(v).mod(P);
        BigInteger v7 = v3.multiply(v3).multiply(v).mod(P);
        BigInteger x = u.multiply(v3).multiply(u.multiply(v7).mod(P).modPow(SQRT_EXPONENT, P)).mod(P);
        BigInteger vx2 = v.multiply(x).multiply(x).mod(P);
        if (!vx2.equals(u)) {
            if (!vx2.equals(P.subtract(u).mod(P))) return null;
            x = x.multiply(SQRT_M1).mod(P);
        }
        if (x.signum() == 0 && negative) return null;
        if (x.testBit(0) != negative) x = P.subtract(x);
        return x;
    }

    private static BigInteger fromLittleEndian(byte[] bytes) {
        byte[] bigEndian = new byte[bytes.length + 1]; // the leading zero keeps it positive
        for (int i = 0; i < bytes.length; i++) bigEndian[bytes.length - i] = bytes[i];
        return new BigInteger(bigEndian);
    }

    private static byte[] toLittleEndian(BigInteger value) {
        byte[] bigEndian = value.toByteArray();
        byte[] bytes = new byte[32];
        for (int i = 0; i < 32 && i < bigEndian.length; i++) bytes[i] = bigEndian[bigEndian.length - 1 - i];
        return bytes;
    }
}
