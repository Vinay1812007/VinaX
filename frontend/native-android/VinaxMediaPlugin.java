package __PKG__;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.util.Log;
import androidx.media.MediaBrowserServiceCompat.Result;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * VinaX's own media-session bridge. JS calls setMetadata / setPlaybackState /
 * setPosition; the plugin forwards to VinaxMediaService (which owns the
 * notification + MediaSession) and relays hardware / notification / headset
 * control events back to JS via "action". Also answers car and watch
 * media-browser requests.
 *
 * Delivery: once the service is started, updates go straight to the live
 * instance (no service start per position tick). Before that — and after a
 * stop — the service is started with startForegroundService(). Android 12+
 * refuses that while the app is in the background; the failure is caught,
 * reported to JS as a rejected call, and the WebView is asked to re-send
 * its state ("resync") the next time the activity resumes.
 */
@CapacitorPlugin(name = "VinaxMedia")
public class VinaxMediaPlugin extends Plugin {

    private static final String TAG = "VinaxMediaPlugin";

    /** Set when the launch intent asked for the player before the WebView
     *  was ready (cold start from a notification tap). Flushed on load(). */
    private static boolean pendingOpenPlayer = false;

    /** A push was lost to the background-start restriction; ask JS to
     *  re-send metadata, state and position on the next resume. */
    private volatile boolean resyncNeeded = false;

    @Override
    public void load() {
        VinaxMediaService.plugin = this;
        if (pendingOpenPlayer) {
            pendingOpenPlayer = false;
            emitOpenPlayer();
        }
    }

    /** Drop the static reference when this bridge dies, so the service never
     *  relays into a destroyed WebView (and the activity is not leaked). */
    @Override
    protected void handleOnDestroy() {
        if (VinaxMediaService.plugin == this) VinaxMediaService.plugin = null;
        super.handleOnDestroy();
    }

    /** The activity is visible again: foreground-service starts are allowed
     *  now, so anything the background refused can be replayed. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (resyncNeeded) {
            resyncNeeded = false;
            emitAction("resync");
        }
    }

    /** Called by the service when startForeground() itself was refused. */
    public void noteForegroundRefused() {
        resyncNeeded = true;
    }

    /** Called by the service when a transport control is pressed. */
    public void emitAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("action", data);
    }

    /** Notification body tapped — JS should open the full-screen player.
     *  Retained until consumed so a cold start (listener attaches after the
     *  intent arrives) still receives it. */
    public void emitOpenPlayer() {
        JSObject data = new JSObject();
        data.put("action", "openplayer");
        notifyListeners("action", data, true);
    }

    /** Called by MainActivity when the launch intent carries the
     *  open-player extra (see VinaxMediaService.EXTRA_OPEN_PLAYER). */
    public static void openPlayerRequested() {
        VinaxMediaPlugin p = VinaxMediaService.plugin;
        if (p != null) p.emitOpenPlayer();
        else pendingOpenPlayer = true;
    }

    /** Called by the service on a lockscreen/Bluetooth seek. */
    public void emitSeek(double seconds) {
        JSObject data = new JSObject();
        data.put("action", "seekto");
        data.put("seekTime", seconds);
        notifyListeners("action", data);
    }

    /** Called by the service when a car or watch client browses a folder. */
    public void emitRequestChildren(String parentId) {
        JSObject data = new JSObject();
        data.put("parentId", parentId);
        notifyListeners("requestChildren", data);
    }

    /** Called by the service when a car or watch client plays a specific item. */
    public void emitPlayFromId(String mediaId) {
        JSObject data = new JSObject();
        data.put("action", "playFromId");
        data.put("mediaId", mediaId);
        notifyListeners("action", data);
    }

    /**
     * Hand an update to the service. Direct call when it is started;
     * otherwise a (foreground) service start. Returns false when the start
     * was refused — the caller rejects the JS call so the diagnostics log
     * shows it, and the WebView re-sends on resume.
     */
    private boolean dispatch(Intent intent) {
        intent.setClass(getContext(), VinaxMediaService.class);
        VinaxMediaService live = VinaxMediaService.instance;
        if (live != null && live.isStarted()) {
            live.apply(intent);
            return true;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            return true;
        } catch (Exception e) {
            // Android 12+: ForegroundServiceStartNotAllowedException while the
            // app is in the background and the service is not yet foreground.
            Log.w(TAG, "service start refused: " + e.getMessage());
            resyncNeeded = true;
            return false;
        }
    }

    private void finish(PluginCall call, boolean ok) {
        if (ok) call.resolve();
        else call.reject("fgs-start-not-allowed");
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_METADATA);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("artist", call.getString("artist", ""));
        i.putExtra("album", call.getString("album", ""));
        i.putExtra("artwork", call.getString("artwork", ""));
        finish(call, dispatch(i));
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_STATE);
        i.putExtra("playing", "playing".equals(call.getString("playbackState", "")));
        finish(call, dispatch(i));
    }

    @PluginMethod
    public void setPosition(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_POSITION);
        i.putExtra("duration", call.getDouble("duration", 0.0));
        i.putExtra("position", call.getDouble("position", 0.0));
        i.putExtra("speed", call.getDouble("playbackRate", 1.0));
        finish(call, dispatch(i));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        VinaxMediaService live = VinaxMediaService.instance;
        if (live == null) {
            // Nothing is running; only the widget could still show a song.
            VinaxPlayerWidget.clear(getContext());
            call.resolve();
            return;
        }
        Intent i = new Intent(VinaxMediaService.ACTION_STOP_SELF);
        finish(call, dispatch(i));
    }

    /** Called by JS to fulfil a car / watch browse request. */
    @PluginMethod
    public void provideChildren(PluginCall call) {
        String parentId = call.getString("parentId");
        JSArray itemsArray = call.getArray("items");

        Result<List<MediaBrowserCompat.MediaItem>> result = VinaxMediaService.pendingResults.remove(parentId);
        if (result != null) {
            List<MediaBrowserCompat.MediaItem> mediaItems = new ArrayList<>();
            if (itemsArray != null) {
                try {
                    List<JSONObject> itemsList = itemsArray.toList();
                    for (JSONObject item : itemsList) {
                        MediaDescriptionCompat.Builder b = new MediaDescriptionCompat.Builder()
                                .setMediaId(item.optString("id"))
                                .setTitle(item.optString("title"))
                                .setSubtitle(item.optString("subtitle"));

                        String iconUrl = item.optString("iconUrl");
                        if (iconUrl != null && !iconUrl.isEmpty()) {
                            b.setIconUri(Uri.parse(iconUrl));
                        }

                        boolean isPlayable = item.optBoolean("playable", true);
                        int flags = isPlayable ? MediaBrowserCompat.MediaItem.FLAG_PLAYABLE : MediaBrowserCompat.MediaItem.FLAG_BROWSABLE;

                        mediaItems.add(new MediaBrowserCompat.MediaItem(b.build(), flags));
                    }
                } catch (JSONException e) {
                    Log.w(TAG, "provideChildren: bad item list: " + e.getMessage());
                }
            }
            result.sendResult(mediaItems);
        }
        call.resolve();
    }
}
