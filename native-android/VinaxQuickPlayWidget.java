package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * Quick-play home-screen widget: VinaX logo + "Play my mix". One tap opens
 * the app with ?widget=play — the web layer (HomePage) auto-starts the Aura
 * Mix as soon as its hero songs land. No service, no polling, no battery
 * cost: the widget is a static RemoteViews with a single PendingIntent.
 *
 * Registered in AndroidManifest.xml + res/ files by scripts/patch-android.js.
 */
public class VinaxQuickPlayWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.vinax_widget_quickplay);
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.sirimillavinay.online/?widget=play"));
            intent.setClass(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.vinax_widget_root, pi);
            manager.updateAppWidget(id, views);
        }
    }
}
