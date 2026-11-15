package com.michael.teneo.history;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.util.Arrays;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class AppIconsTest {

    @Rule
    public TemporaryFolder temporary = new TemporaryFolder();

    private static byte[] png(int length) {
        byte[] bytes = new byte[length];
        byte[] signature = { (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
        System.arraycopy(signature, 0, bytes, 0, signature.length);
        return bytes;
    }

    private AppIcons icons() {
        // not made yet: the first save makes it
        return new AppIcons(new File(temporary.getRoot(), "app-icons"));
    }

    @Test
    public void anIconIsKeptByItsAppsName() {
        AppIcons icons = icons();
        assertEquals(Arrays.asList("Safari", "Notes"), icons.missing(Arrays.asList("Safari", "Notes")));
        assertNull(icons.read("Safari"));

        assertTrue(icons.save("Safari", png(100)));
        assertArrayEquals(png(100), icons.read("Safari"));
        assertEquals(Arrays.asList("Notes"), icons.missing(Arrays.asList("Safari", "Notes")));
        // another AppIcons over the same folder sees it: the service saves, the app reads
        assertArrayEquals(png(100), icons().read("Safari"));
    }

    @Test
    public void aNameIsNeverAPath() {
        AppIcons icons = icons();
        String name = "../../databases/teneo.sqlite";
        assertTrue(icons.save(name, png(50)));
        assertArrayEquals(png(50), icons.read(name));
        File[] written = new File(temporary.getRoot(), "app-icons").listFiles();
        assertEquals(1, written.length);
        assertTrue(written[0].getName().matches("[0-9a-f]{64}\\.png"));
        assertEquals(1, temporary.getRoot().listFiles().length);
    }

    @Test
    public void onlyASmallPngIsKept() {
        AppIcons icons = icons();
        assertFalse(icons.save("Fake", "<svg onload=alert(1)>".getBytes()));
        assertFalse(icons.save("Huge", png(AppIcons.MAX_BYTES + 1)));
        assertFalse(icons.save("Empty", new byte[0]));
        assertFalse(icons.save("", png(50)));
        assertFalse(icons.save(null, png(50)));
        assertFalse(icons.save("x".repeat(AppIcons.MAX_NAME_LENGTH + 1), png(50)));
        assertTrue(icons.save("Largest", png(AppIcons.MAX_BYTES)));
        assertNull(icons.read("Fake"));
        assertEquals(Arrays.asList("Fake"), icons.missing(Arrays.asList("Fake", "", "Largest")));
    }

    @Test
    public void aSavedIconIsToldToWhoeverListens() {
        int[] told = { 0 };
        AppIcons.Listener listener = () -> told[0] += 1;
        AppIcons.addListener(listener);
        try {
            AppIcons icons = icons();
            icons.save("Safari", png(100));
            icons.save("Fake", new byte[] { 1, 2, 3 });
            assertEquals(1, told[0]);
        } finally {
            AppIcons.removeListener(listener);
        }
        icons().save("Notes", png(100));
        assertEquals(1, told[0]);
    }
}
