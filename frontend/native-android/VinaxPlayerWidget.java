package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * v5.9.0 — the Now Playing home-screen widget: artwork, title, artist and
 * previous / play-pause / next. VinaxMediaService pushes every metadata and
 * state change here (it already owns the notification + MediaSession), so
 * the widget costs nothing while nothing plays and never polls.
 *
 * Taps go out as broadcasts to this receiver. While the app process is
 * alive they become transport intents to the service (a widget tap is a
 * user interaction, so the foreground-service start is allowed); when the
 * process is gone there is no WebView to play anything, so the tap opens
 * the app on the full-screen player instead.
 *
 * Registered in AndroidManifest.xml + res/ files by scripts/patch-android.js.
 */
public class VinaxPlayerWidget extends AppWidgetProvider {
    static final String ACT_PREV   = "vinax.widget.PREV";
    static final String ACT_TOGGLE = "vinax.widget.TOGGLE";
    static final String ACT_NEXT   = "vinax.widget.NEXT";

    /* Last state the service pushed. Process-local: a cold process shows
       the idle face until the service reports again. */
    private static String  title   = "";
    private static String  artist  = "";
    private static Bitmap  artwork = null;
    private static boolean playing = false;

    public static void push(Context context, String t, String a, Bitmap art, boolean isPlaying) {
        title   = t == null ? "" : t;
        artist  = a == null ? "" : a;
        artwork = art;
        playing = isPlaying;
        refresh(context);
    }

    public static void clear(Context context) {
        push(context, "", "", null, false);
    }

    static void refresh(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, VinaxPlayerWidget.class));
            for (int id : ids) manager.updateAppWidget(id, build(context));
        } catch (Exception ignored) {
            /* no widget placed, or the launcher is busy — nothing to do */
        }
    }

    private static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.vinax_widget_player);
        boolean has = !title.isEmpty();
        v.setTextViewText(R.id.vinax_wp_title, has ? title : "VinaX");
        v.setTextViewText(R.id.vinax_wp_artist, has ? artist : "Tap to start listening");
        if (artwork != null) v.setImageViewBitmap(R.id.vinax_wp_art, artwork);
        else v.setImageViewResource(R.id.vinax_wp_art, R.mipmap.ic_launcher);
        v.setImageViewResource(R.id.vinax_wp_toggle,
            playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        v.setContentDescription(R.id.vinax_wp_toggle, playing ? "Pause" : "Play");
        v.setOnClickPendingIntent(R.id.vinax_wp_prev,   action(context, ACT_PREV, 1));
        v.setOnClickPendingIntent(R.id.vinax_wp_toggle, action(context, ACT_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.vinax_wp_next,   action(context, ACT_NEXT, 3));
        v.setOnClickPendingIntent(R.id.vinax_wp_root,   open(context));
        return v;
    }

    private static int piFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private static PendingIntent action(Context context, String act, int req) {
        Intent i = new Intent(context, VinaxPlayerWidget.class).setAction(act);
        return PendingIntent.getBroadcast(context, req, i, piFlags());
    }

    private static PendingIntent open(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        launch.putExtra(VinaxMediaService.EXTRA_OPEN_PLAYER, true);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 10, launch, piFlags());
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) manager.updateAppWidget(id, build(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String act = intent.getAction();
        if (act == null) return;
        String svc;
        switch (act) {
            case ACT_PREV:   svc = VinaxMediaService.ACTION_PREV; break;
            case ACT_NEXT:   svc = VinaxMediaService.ACTION_NEXT; break;
            case ACT_TOGGLE: svc = playing ? VinaxMediaService.ACTION_PAUSE : VinaxMediaService.ACTION_PLAY; break;
            default: return;
        }
        if (VinaxMediaService.plugin == null) {
            // No live WebView to play anything — open the app on the player.
            try { open(context).send(); } catch (Exception ignored) { }
            return;
        }
        Intent s = new Intent(svc).setClass(context, VinaxMediaService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(s);
            else context.startService(s);
        } catch (Exception e) {
            try { open(context).send(); } catch (Exception ignored) { }
        }
    }
}
