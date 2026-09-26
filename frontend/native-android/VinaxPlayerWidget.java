package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;
import android.os.Bundle;
import android.widget.RemoteViews;

/**
 * The Now Playing home-screen widget: rounded artwork, bold title, artist and
 * previous / play-pause / next. VinaxMediaService pushes every metadata and
 * state change here (it already owns the notification + MediaSession), so
 * the widget costs nothing while nothing plays and never polls.
 *
 * Two layouts share one set of ids: the 4x1 row and, once the launcher
 * reports two rows or more of height, the taller card with a centred
 * transport row.
 *
 * Taps go out as broadcasts to this receiver, and the receiver decides at
 * tap time what to do — the baked RemoteViews stay valid when the process
 * that built them is long gone:
 *  - the app process is alive (VinaxMediaService.plugin != null): the tap
 *    becomes a transport intent to the service. A widget tap is a user
 *    interaction, so the foreground-service start is allowed on Android 12+;
 *  - the process is gone: there is no WebView to play anything, so play
 *    opens the app with ?widget=play (it starts the listener's mix by
 *    itself, exactly like the quick-play widget) and previous / next open
 *    the app on the full-screen player.
 *
 * Registered in AndroidManifest.xml + res/ files by scripts/patch-android.js.
 */
public class VinaxPlayerWidget extends AppWidgetProvider {
    static final String ACT_PREV   = "vinax.widget.PREV";
    static final String ACT_TOGGLE = "vinax.widget.TOGGLE";
    static final String ACT_NEXT   = "vinax.widget.NEXT";

    /** Launchers report a widget's height in dp; two rows are ~110 dp on the
     *  standard grid, so anything from here up gets the tall card. */
    private static final int TALL_MIN_HEIGHT_DP = 150;
    /** Longest edge of the bitmap handed to the launcher (Binder-safe). */
    private static final int ART_PX = 256;

    /* Last state the service pushed. Process-local: a cold process shows
       the idle face until the service reports again. */
    private static String  title   = "";
    private static String  artist  = "";
    private static Bitmap  artwork = null;
    private static boolean playing = false;

    /* The rounded copy of `artwork`, rebuilt only when the bitmap changes. */
    private static Bitmap roundedSource = null;
    private static Bitmap roundedCache  = null;

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
            for (int id : ids) manager.updateAppWidget(id, build(context, isTall(manager, id)));
        } catch (Exception ignored) {
            /* no widget placed, or the launcher is busy — nothing to do */
        }
    }

    private static boolean isTall(AppWidgetManager manager, int id) {
        try {
            Bundle options = manager.getAppWidgetOptions(id);
            if (options == null) return false;
            return options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) >= TALL_MIN_HEIGHT_DP;
        } catch (Exception e) {
            return false;
        }
    }

    private static RemoteViews build(Context context, boolean tall) {
        RemoteViews v = new RemoteViews(context.getPackageName(),
                tall ? R.layout.vinax_widget_player_tall : R.layout.vinax_widget_player);
        boolean has = !title.isEmpty();
        v.setTextViewText(R.id.vinax_wp_title,
                has ? title : context.getString(R.string.vinax_widget_idle_title));
        v.setTextViewText(R.id.vinax_wp_artist,
                has ? artist : context.getString(R.string.vinax_widget_idle_subtitle));
        Bitmap art = rounded(artwork);
        if (art != null) v.setImageViewBitmap(R.id.vinax_wp_art, art);
        else v.setImageViewResource(R.id.vinax_wp_art, R.drawable.vinax_widget_art_placeholder);
        v.setImageViewResource(R.id.vinax_wp_toggle,
                playing ? R.drawable.vinax_ic_pause : R.drawable.vinax_ic_play);
        v.setContentDescription(R.id.vinax_wp_toggle,
                context.getString(playing ? R.string.vinax_cd_pause : R.string.vinax_cd_play));
        v.setOnClickPendingIntent(R.id.vinax_wp_prev,   action(context, ACT_PREV, 1));
        v.setOnClickPendingIntent(R.id.vinax_wp_toggle, action(context, ACT_TOGGLE, 2));
        v.setOnClickPendingIntent(R.id.vinax_wp_next,   action(context, ACT_NEXT, 3));
        // Artwork, title and the card itself open the full-screen player.
        v.setOnClickPendingIntent(R.id.vinax_wp_art,  open(context));
        v.setOnClickPendingIntent(R.id.vinax_wp_text, open(context));
        v.setOnClickPendingIntent(R.id.vinax_wp_root, open(context));
        return v;
    }

    /**
     * RemoteViews cannot clip an ImageView, so the cover is rounded here:
     * a centre-square crop, scaled to ART_PX, with corners at roughly 12 dp
     * of the 56–64 dp tile (~21 % of the edge). Falls back to the raw bitmap
     * if anything goes wrong; null stays null (placeholder drawable).
     */
    static Bitmap rounded(Bitmap src) {
        if (src == null) return null;
        if (src == roundedSource && roundedCache != null) return roundedCache;
        try {
            int side = Math.min(src.getWidth(), src.getHeight());
            if (side <= 0) return src;
            int size = Math.min(side, ART_PX);
            Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            RectF dst = new RectF(0, 0, size, size);
            float radius = size * 0.21f;
            canvas.drawRoundRect(dst, radius, radius, paint);
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            int left = (src.getWidth() - side) / 2;
            int top  = (src.getHeight() - side) / 2;
            canvas.drawBitmap(src, new Rect(left, top, left + side, top + side), dst, paint);
            roundedSource = src;
            roundedCache  = out;
            return out;
        } catch (Exception e) {
            return src;
        }
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
        for (int id : appWidgetIds) manager.updateAppWidget(id, build(context, isTall(manager, id)));
    }

    /** The listener resized the widget: swap between the row and the card. */
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        super.onAppWidgetOptionsChanged(context, manager, appWidgetId, newOptions);
        boolean tall = newOptions != null
                && newOptions.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) >= TALL_MIN_HEIGHT_DP;
        try {
            manager.updateAppWidget(appWidgetId, build(context, tall));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String act = intent.getAction();
        if (act == null) return;
        String svc;
        switch (act) {
            case ACT_PREV:   svc = VinaxMediaService.ACTION_PREV;   break;
            case ACT_NEXT:   svc = VinaxMediaService.ACTION_NEXT;   break;
            case ACT_TOGGLE: svc = VinaxMediaService.ACTION_TOGGLE; break;
            default: return;
        }
        if (VinaxMediaService.plugin == null) {
            // No live WebView to play anything. Play: open the app and let it
            // start the listener's mix (?widget=play). Previous / next: open
            // the app on the player.
            PendingIntent target = ACT_TOGGLE.equals(act)
                    ? VinaxQuickPlayWidget.playIntent(context) : open(context);
            try { target.send(); } catch (Exception ignored) { }
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
