package com.michael.teneo;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/**
 * What every notification of Teneo's shares: its logo, in the status bar and
 * on the card, in Teneo's blue, and a tap that opens the app.
 */
public final class Notifications {

    /** The sync service's, and the notice that sync is paused in its place */
    public static final int SYNC = 1;
    public static final int UPDATE = 2;

    /** On the intent that opens the app from the update notification */
    public static final String EXTRA_OPEN_UPDATE = "com.michael.teneo.OPEN_UPDATE";

    /** The blue of the app icon's sheet */
    private static final int BRAND = 0xFF236ADE;

    private Notifications() {}

    /** A notification on `channel` that opens the app when tapped */
    public static Notification.Builder builder(Context context, String channel) {
        return builder(context, channel, false);
    }

    /** `opensUpdate`: the app opens on the update it was told of */
    public static Notification.Builder builder(Context context, String channel, boolean opensUpdate) {
        Notification.Builder builder = new Notification.Builder(context, channel).setSmallIcon(R.drawable.ic_stat_teneo).setColor(BRAND);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            if (opensUpdate) launch.putExtra(EXTRA_OPEN_UPDATE, true);
            // extras don't tell two PendingIntents apart; the request code does
            builder.setContentIntent(
                PendingIntent.getActivity(
                    context,
                    opensUpdate ? 1 : 0,
                    launch,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                )
            );
        }
        return builder;
    }
}
