package __PKG__;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;
import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.app.MediaRouteControllerDialog;
import androidx.mediarouter.media.MediaRouteSelector;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.cast.CastDevice;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaSeekOptions;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastState;
import com.google.android.gms.cast.framework.CastStateListener;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.images.WebImage;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Google Cast in the Android app, registered as "VinaxCast". The page
 * (frontend/src/services/cast/native.ts) drives it the same way the website
 * drives the Cast web SDK: the receiver plays the song, the phone's own
 * <audio> element keeps playing muted as the clock for "song ended, play
 * the next one".
 *
 * Methods: init, showDevicePicker, loadMedia, play, pause, seek, setVolume,
 * endSession. Events: "availability" { devices }, "session" { connected,
 * deviceName }, "status" { state, idleReason, position, duration, url }
 * (seconds; at most once a second while playing, and on every change).
 *
 * Safety: nothing Cast is touched at app start. The Cast framework is only
 * loaded when the page calls init() (the first time the listener opens
 * "Connect to a device", like the website's Cast script), off the
 * main thread (CastContext.getSharedInstance(context, executor)), and only
 * when Google Play services is there. Any failure answers
 * { available: false } and the page hides casting; it never throws into the
 * activity. Every Cast call runs on the main thread, as the SDK requires.
 *
 * Settings (receiver id, no Cast notification) are in
 * VinaxCastOptionsProvider.java. Checked against the
 * play-services-cast-framework 22.3.1 and mediarouter 1.8.0-beta01 classes
 * on 2026-11-17.
 */
@CapacitorPlugin(name = "VinaxCast")
public class VinaxCastPlugin extends Plugin {

    private static final String TAG = "VinaxCast";
    /** How often the receiver's position is reported while it plays. */
    private static final long PROGRESS_MS = 1000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    private CastContext cast = null;
    private boolean loading = false;
    private boolean failed = false;
    private final List<PluginCall> waiting = new ArrayList<>();

    private CastSession session = null;
    private RemoteMediaClient client = null;

    // Made only once the framework has loaded, so constructing the plugin at
    // app start touches no Cast class.
    private SessionManagerListener<CastSession> sessionListener = null;
    private CastStateListener stateListener = null;
    private RemoteMediaClient.Callback mediaCallback = null;
    private RemoteMediaClient.ProgressListener progressListener = null;

    // ---- start-up --------------------------------------------------------

    /** Load the Cast framework (once). Resolves { available, devices, connected, deviceName }. */
    @PluginMethod
    public void init(PluginCall call) {
        main.post(() -> {
            if (cast != null) {
                call.resolve(snapshot());
                return;
            }
            if (failed) {
                call.resolve(unavailable());
                return;
            }
            waiting.add(call);
            if (loading) return;
            loading = true;
            try {
                int services = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
                if (services != ConnectionResult.SUCCESS) {
                    onFailed("Google Play services missing (" + services + ")");
                    return;
                }
                final ExecutorService loader = Executors.newSingleThreadExecutor();
                CastContext.getSharedInstance(getContext(), loader)
                        .addOnSuccessListener((CastContext ctx) -> {
                            loader.shutdown();
                            onReady(ctx);
                        })
                        .addOnFailureListener((Exception e) -> {
                            loader.shutdown();
                            onFailed(e.getMessage());
                        });
            } catch (Throwable t) {
                onFailed(t.getMessage());
            }
        });
    }

    private void onReady(CastContext ctx) {
        try {
            cast = ctx;
            makeListeners();
            ctx.getSessionManager().addSessionManagerListener(sessionListener, CastSession.class);
            ctx.addCastStateListener(stateListener);
            CastSession current = ctx.getSessionManager().getCurrentCastSession();
            if (current != null && current.isConnected()) attach(current);
        } catch (Throwable t) {
            cast = null;
            onFailed(t.getMessage());
            return;
        }
        loading = false;
        JSObject out = snapshot();
        for (PluginCall c : waiting) c.resolve(out);
        waiting.clear();
    }

    private void onFailed(String why) {
        Log.w(TAG, "Cast unavailable: " + why);
        failed = true;
        loading = false;
        JSObject out = unavailable();
        for (PluginCall c : waiting) c.resolve(out);
        waiting.clear();
    }

    private void makeListeners() {
        sessionListener = new SessionManagerListener<CastSession>() {
            @Override
            public void onSessionStarting(CastSession s) {
            }

            @Override
            public void onSessionStarted(CastSession s, String sessionId) {
                attach(s);
                emitSession();
            }

            @Override
            public void onSessionStartFailed(CastSession s, int error) {
                Log.w(TAG, "session start failed: " + error);
            }

            @Override
            public void onSessionEnding(CastSession s) {
            }

            @Override
            public void onSessionEnded(CastSession s, int error) {
                detach();
                emitSession();
            }

            @Override
            public void onSessionResuming(CastSession s, String sessionId) {
            }

            @Override
            public void onSessionResumed(CastSession s, boolean wasSuspended) {
                attach(s);
                emitSession();
            }

            @Override
            public void onSessionResumeFailed(CastSession s, int error) {
                detach();
                emitSession();
            }

            @Override
            public void onSessionSuspended(CastSession s, int reason) {
                // The connection dropped for a moment; the framework resumes
                // it on its own (onSessionResumed) or ends it.
            }
        };
        stateListener = (int state) -> {
            JSObject out = new JSObject();
            out.put("devices", state != CastState.NO_DEVICES_AVAILABLE);
            notifyListeners("availability", out);
        };
        mediaCallback = new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                emitStatus();
            }
        };
        progressListener = (long progressMs, long durationMs) -> emitStatus();
    }

    // ---- session ---------------------------------------------------------

    private void attach(CastSession s) {
        if (s == session && client != null) return;
        detach();
        session = s;
        try {
            client = s.getRemoteMediaClient();
            if (client != null) {
                client.registerCallback(mediaCallback);
                client.addProgressListener(progressListener, PROGRESS_MS);
            }
        } catch (Exception e) {
            Log.w(TAG, "attach: " + e.getMessage());
            client = null;
        }
    }

    private void detach() {
        RemoteMediaClient c = client;
        client = null;
        session = null;
        if (c == null) return;
        try {
            c.unregisterCallback(mediaCallback);
            c.removeProgressListener(progressListener);
        } catch (Exception ignored) {
            // the session is gone already
        }
    }

    private boolean connected() {
        return session != null && session.isConnected();
    }

    private String deviceName() {
        try {
            CastDevice d = session != null ? session.getCastDevice() : null;
            return d != null ? d.getFriendlyName() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private JSObject unavailable() {
        JSObject out = new JSObject();
        out.put("available", false);
        out.put("devices", false);
        out.put("connected", false);
        return out;
    }

    private JSObject snapshot() {
        JSObject out = new JSObject();
        out.put("available", true);
        boolean devices = true;
        try {
            devices = cast.getCastState() != CastState.NO_DEVICES_AVAILABLE;
        } catch (Exception ignored) {
            // keep the button: the picker says when nothing is found
        }
        out.put("devices", devices);
        boolean on = connected();
        out.put("connected", on);
        String name = on ? deviceName() : null;
        if (name != null) out.put("deviceName", name);
        return out;
    }

    private void emitSession() {
        JSObject out = new JSObject();
        boolean on = connected();
        out.put("connected", on);
        String name = on ? deviceName() : null;
        if (name != null) out.put("deviceName", name);
        notifyListeners("session", out);
    }

    private void emitStatus() {
        RemoteMediaClient c = client;
        if (c == null) return;
        try {
            JSObject out = new JSObject();
            out.put("state", stateName(c.getPlayerState()));
            out.put("idleReason", idleName(c.getIdleReason()));
            out.put("position", c.getApproximateStreamPosition() / 1000.0);
            out.put("duration", c.getStreamDuration() / 1000.0);
            MediaInfo info = c.getMediaInfo();
            String url = info != null ? info.getContentId() : null;
            if (url != null) out.put("url", url);
            notifyListeners("status", out);
        } catch (Exception e) {
            Log.w(TAG, "status: " + e.getMessage());
        }
    }

    // Plain if-chains, not switch: the SDK's constants are not guaranteed to
    // be compile-time constants.
    private static String stateName(int s) {
        if (s == MediaStatus.PLAYER_STATE_PLAYING) return "playing";
        if (s == MediaStatus.PLAYER_STATE_PAUSED) return "paused";
        if (s == MediaStatus.PLAYER_STATE_BUFFERING) return "buffering";
        if (s == MediaStatus.PLAYER_STATE_LOADING) return "loading";
        if (s == MediaStatus.PLAYER_STATE_IDLE) return "idle";
        return "unknown";
    }

    private static String idleName(int r) {
        if (r == MediaStatus.IDLE_REASON_FINISHED) return "finished";
        if (r == MediaStatus.IDLE_REASON_ERROR) return "error";
        if (r == MediaStatus.IDLE_REASON_CANCELED) return "canceled";
        if (r == MediaStatus.IDLE_REASON_INTERRUPTED) return "interrupted";
        return "none";
    }

    // ---- page commands ---------------------------------------------------

    /** Not connected: the list of TVs and speakers. Connected: the TV's card with Stop casting. */
    @PluginMethod
    public void showDevicePicker(PluginCall call) {
        main.post(() -> {
            if (cast == null) {
                call.reject("Cast unavailable");
                return;
            }
            AppCompatActivity activity = getActivity();
            if (activity == null || activity.isFinishing()) {
                call.reject("No window");
                return;
            }
            try {
                if (connected()) {
                    new MediaRouteControllerDialog(activity).show();
                } else {
                    MediaRouteSelector selector = cast.getMergedSelector();
                    if (selector == null) {
                        call.reject("Cast unavailable");
                        return;
                    }
                    MediaRouteChooserDialog chooser = new MediaRouteChooserDialog(activity);
                    chooser.setRouteSelector(selector);
                    chooser.show();
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the device list", e);
            }
        });
    }

    /** { url, contentType, title, artist, image, startTime (s), autoplay } → the receiver plays it. */
    @PluginMethod
    public void loadMedia(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No url");
            return;
        }
        final String type = call.getString("contentType", "audio/mp4");
        final String title = call.getString("title", "");
        final String artist = call.getString("artist", "");
        final String image = call.getString("image", "");
        final double start = call.getDouble("startTime", 0.0);
        final boolean autoplay = call.getBoolean("autoplay", true);
        main.post(() -> {
            RemoteMediaClient c = client;
            if (c == null) {
                call.reject("Not casting");
                return;
            }
            try {
                MediaMetadata meta = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
                meta.putString(MediaMetadata.KEY_TITLE, title == null ? "" : title);
                meta.putString(MediaMetadata.KEY_ARTIST, artist == null ? "" : artist);
                // The TV fetches the artwork itself: only network URLs (services/cast/media.ts sends no others).
                if (image != null && (image.startsWith("https://") || image.startsWith("http://"))) meta.addImage(new WebImage(Uri.parse(image)));
                MediaInfo info = new MediaInfo.Builder(url)
                        .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                        .setContentType(type == null ? "audio/mp4" : type)
                        .setMetadata(meta)
                        .build();
                long startMs = Math.max(0L, Math.round(start * 1000.0));
                MediaLoadRequestData request = new MediaLoadRequestData.Builder()
                        .setMediaInfo(info)
                        .setAutoplay(autoplay)
                        .setCurrentTime(startMs)
                        .build();
                c.load(request).setResultCallback((RemoteMediaClient.MediaChannelResult result) -> {
                    if (result.getStatus().isSuccess()) call.resolve();
                    else call.reject("Cast load failed (" + result.getStatus().getStatusCode() + ")");
                });
            } catch (Exception e) {
                call.reject("Cast load failed", e);
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        withClient(call, (RemoteMediaClient c) -> c.play());
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withClient(call, (RemoteMediaClient c) -> c.pause());
    }

    /** { position } in seconds. */
    @PluginMethod
    public void seek(PluginCall call) {
        final double position = call.getDouble("position", 0.0);
        final long ms = Math.max(0L, Math.round(position * 1000.0));
        withClient(call, (RemoteMediaClient c) -> c.seek(new MediaSeekOptions.Builder().setPosition(ms).build()));
    }

    /** { level } 0..1: the TV's own volume. */
    @PluginMethod
    public void setVolume(PluginCall call) {
        final double level = Math.min(1.0, Math.max(0.0, call.getDouble("level", 1.0)));
        main.post(() -> {
            CastSession s = session;
            if (s == null || !s.isConnected()) {
                call.reject("Not casting");
                return;
            }
            try {
                s.setVolume(level);
                call.resolve();
            } catch (Exception e) {
                call.reject("Volume failed", e);
            }
        });
    }

    /** Stop casting: the TV stops too (VinaxCastOptionsProvider). */
    @PluginMethod
    public void endSession(PluginCall call) {
        main.post(() -> {
            try {
                if (cast != null) {
                    SessionManager sessions = cast.getSessionManager();
                    sessions.endCurrentSession(true);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not stop casting", e);
            }
        });
    }

    private interface ClientAction {
        void run(RemoteMediaClient c);
    }

    private void withClient(PluginCall call, ClientAction action) {
        main.post(() -> {
            RemoteMediaClient c = client;
            if (c == null) {
                call.reject("Not casting");
                return;
            }
            try {
                action.run(c);
                call.resolve();
            } catch (Exception e) {
                call.reject("Cast command failed", e);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (cast != null) {
                if (sessionListener != null) cast.getSessionManager().removeSessionManagerListener(sessionListener, CastSession.class);
                if (stateListener != null) cast.removeCastStateListener(stateListener);
            }
            detach();
        } catch (Exception ignored) {
            // the framework is going away with the activity
        }
        super.handleOnDestroy();
    }
}
