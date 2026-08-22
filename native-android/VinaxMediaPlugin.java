package __PKG__;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.util.Base64;
import androidx.media.MediaBrowserServiceCompat.Result;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * VinaX's own media-session bridge. Replaces the third-party plugin entirely.
 * JS calls setMetadata / setPlaybackState / setPosition; the plugin forwards
 * to VinaxMediaService (which owns the notification + MediaSession) and relays
 * hardware/notification/Bluetooth control events back to JS via "action".
 * Now includes methods to support Android Auto media browsing requests.
 */
@CapacitorPlugin(name = "VinaxMedia")
public class VinaxMediaPlugin extends Plugin {

    /** Set when the launch intent asked for the player before the WebView
     *  was ready (cold start from a notification tap). Flushed on load(). */
    private static boolean pendingOpenPlayer = false;

    @Override
    public void load() {
        VinaxMediaService.plugin = this;
        if (pendingOpenPlayer) {
            pendingOpenPlayer = false;
            emitOpenPlayer();
        }
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

    /** Called by the service when Android Auto requests browsing a folder. */
    public void emitRequestChildren(String parentId) {
        JSObject data = new JSObject();
        data.put("parentId", parentId);
        notifyListeners("requestChildren", data);
    }

    /** Called by the service when Android Auto requests to play a specific item. */
    public void emitPlayFromId(String mediaId) {
        JSObject data = new JSObject();
        data.put("action", "playFromId");
        data.put("mediaId", mediaId);
        notifyListeners("action", data);
    }

    private void startService(Intent intent) {
        intent.setClass(getContext(), VinaxMediaService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_METADATA);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("artist", call.getString("artist", ""));
        i.putExtra("album", call.getString("album", ""));
        i.putExtra("artwork", call.getString("artwork", ""));
        startService(i);
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_STATE);
        i.putExtra("playing", "playing".equals(call.getString("playbackState", "")));
        startService(i);
        call.resolve();
    }

    @PluginMethod
    public void setPosition(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_POSITION);
        i.putExtra("duration", call.getDouble("duration", 0.0));
        i.putExtra("position", call.getDouble("position", 0.0));
        i.putExtra("speed", call.getDouble("playbackRate", 1.0));
        startService(i);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(VinaxMediaService.ACTION_STOP_SELF);
        startService(i);
        call.resolve();
    }

    /** Called by JS to fulfill an Android Auto browse request. */
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
                    e.printStackTrace();
                }
            }
            result.sendResult(mediaItems);
        }
        call.resolve();
    }
}
