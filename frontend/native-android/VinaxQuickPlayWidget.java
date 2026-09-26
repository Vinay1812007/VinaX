package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * Quick-play home-screen widget: VinaX logo, "Play my mix", a shuffle hint
 * and the violet play disc. One tap opens the app with ?widget=play — the
 * web layer (AppLayout relays the URL, HomePage auto-starts the mix as soon
 * as its hero songs land). No service, no polling, no battery cost: the
 * widget is a static RemoteViews with a single PendingIntent.
 *
 * The same intent is what the Now Playing widget's play button falls back
 * to when the app process is gone (VinaxPlayerWidget.onReceive).
 *
 * Registered in AndroidManifest.xml + res/ files by scripts/patch-android.js.
 */
public class VinaxQuickPlayWidget extends AppWidgetProvider {
    /** The app's own origin (capacitor.config.ts server.url) + the widget flag. */
    static final String PLAY_URL = "https://www.sirimillavinay.online/?widget=play";

    /** Opens the app and starts the listener's mix. Shared with VinaxPlayerWidget. */
    public static PendingIntent playIntent(Context context) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(PLAY_URL));
        intent.setClass(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, intent, flags);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.vinax_widget_quickplay);
            PendingIntent pi = playIntent(context);
            views.setOnClickPendingIntent(R.id.vinax_widget_root, pi);
            views.setOnClickPendingIntent(R.id.vinax_widget_play, pi);
            manager.updateAppWidget(id, views);
        }
    }
}
