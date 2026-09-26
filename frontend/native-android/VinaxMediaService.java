package __PKG__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Self-contained foreground media service. Extends MediaBrowserServiceCompat
 * so car and watch clients can browse and start playback.
 *
 * Audio is NOT decoded here: the web player's audio element inside the
 * WebView plays it. This service mirrors state into the media session, the
 * MediaStyle notification and the home-screen widget, and relays transport
 * commands back to the WebView through VinaxMediaPlugin.
 *
 * Foreground contract (Android 8–15):
 *  - every start through startForegroundService() is answered by
 *    startForeground() synchronously in onStartCommand(), on every path
 *    (metadata, state, position ticks, widget and notification taps, media
 *    buttons, stop) — the 5 s window is never left to a posted message;
 *  - the notification carries the mediaPlayback foreground-service type
 *    declared in the manifest (required on Android 14+);
 *  - the service stays in the foreground while paused, so a later play from
 *    the WebView in the background updates an already-foreground service
 *    instead of trying to enter the foreground from the background (which
 *    Android 12+ refuses). It leaves the foreground only on an explicit stop,
 *    on task removal and on destroy;
 *  - once started, the plugin talks to the live instance directly
 *    (apply()), so a position tick is a method call, not a service start.
 */
public class VinaxMediaService extends MediaBrowserServiceCompat {

    private static final String TAG = "VinaxMediaService";
    private static final String CHANNEL_ID = "vinax_playback";
    private static final int NOTIF_ID = 1001;
    public static final String ACTION_METADATA  = "vinax.METADATA";
    public static final String ACTION_STATE     = "vinax.STATE";
    public static final String ACTION_POSITION  = "vinax.POSITION";
    public static final String ACTION_STOP_SELF = "vinax.STOP_SELF";
    /** Launch-intent extra: tapping the notification body / media session
     *  should open the app ON THE FULL-SCREEN PLAYER (4.16.1). MainActivity
     *  reads it and relays via VinaxMediaPlugin.openPlayerRequested(). */
    public static final String EXTRA_OPEN_PLAYER = "vinax.open.player";
    /* Public: the home-screen widget (VinaxPlayerWidget) sends these too. */
    public static final String ACTION_PLAY   = "vinax.PLAY";
    public static final String ACTION_PAUSE  = "vinax.PAUSE";
    public static final String ACTION_PREV   = "vinax.PREV";
    public static final String ACTION_NEXT   = "vinax.NEXT";
    /** Play or pause from the service's own view of the state — the widget
     *  uses it so a cold process cannot send the wrong half of the pair. */
    public static final String ACTION_TOGGLE = "vinax.TOGGLE";
    private static final String ACTION_STOP  = "vinax.STOP";
    private static final String ROOT_ID      = "vinax_root";

    public static VinaxMediaPlugin plugin;
    /** The live service, for the plugin's direct path (null when not created). */
    public static volatile VinaxMediaService instance;

    private MediaSessionCompat session;
    private final Handler main = new Handler(Looper.getMainLooper());

    private String title  = "";
    private String artist = "";
    private String album  = "VinaX";
    private Bitmap artwork;
    private boolean playing    = false;
    private long    duration   = 0;
    private long    position   = 0;
    private float   speed      = 1f;
    private boolean foreground = false;
    /** True between the first onStartCommand() and a stop: only then may the
     *  plugin bypass startForegroundService() and call apply() directly. */
    private volatile boolean started = false;
    private BroadcastReceiver noisyReceiver;

    /* Pending browse result from a trusted car / watch client. */
    public static final Map<String, Result<List<MediaBrowserCompat.MediaItem>>> pendingResults = new HashMap<>();

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) launch.putExtra(EXTRA_OPEN_PLAYER, true);
        PendingIntent pi = launch != null
                ? PendingIntent.getActivity(this, 0, launch, piFlags()) : null;

        session = new MediaSessionCompat(this, "VinaX");
        if (pi != null) session.setSessionActivity(pi);

        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()             { relay("play"); }
            @Override public void onPause()            { relay("pause"); }
            @Override public void onSkipToNext()       { relay("nexttrack"); }
            @Override public void onSkipToPrevious()   { relay("previoustrack"); }
            @Override public void onStop()             { relay("stop"); }
            @Override public void onSeekTo(long pos) {
                if (plugin != null) plugin.emitSeek(pos / 1000.0);
            }
            @Override public void onPlayFromMediaId(String mediaId, Bundle extras) {
                if (plugin != null) plugin.emitPlayFromId(mediaId);
            }
        });
        session.setActive(true);
        setSessionToken(session.getSessionToken());
        registerNoisyReceiver();
    }

    private void relay(String action) {
        if (plugin != null) plugin.emitAction(action);
    }

    /**
     * Headphones unplugged / Bluetooth audio dropped: every music app pauses
     * here rather than blasting through the speaker. The WebView confirms the
     * new state through the plugin; the mirror is flipped at once so the
     * notification and widget do not lag behind the silence.
     */
    private void registerNoisyReceiver() {
        noisyReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (intent == null
                        || !AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())
                        || !playing) return;
                relay("pause");
                playing = false;
                updateSession();
                promote();
                VinaxPlayerWidget.push(VinaxMediaService.this, title, artist, artwork, false);
            }
        };
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 14 requires the export flag for context-registered
                // receivers; a system broadcast still reaches a non-exported one.
                registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(noisyReceiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "noisy receiver not registered: " + e.getMessage());
            noisyReceiver = null;
        }
    }

    public boolean isStarted() { return started; }

    /**
     * Direct path from VinaxMediaPlugin once the service is started: the
     * intent is applied on the main thread without another service start.
     */
    public void apply(final Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        final String action = intent.getAction();
        main.post(() -> handle(action, intent));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        started = true;
        // Every start may have come through startForegroundService(): enter
        // the foreground right here, before anything else can go wrong.
        if (!foreground) promote();
        MediaButtonReceiver.handleIntent(session, intent);
        if (intent == null || intent.getAction() == null) {
            updateSession();
            return START_NOT_STICKY;
        }
        handle(intent.getAction(), intent);
        return START_NOT_STICKY;
    }

    private void handle(String action, Intent intent) {
        switch (action) {
            case ACTION_METADATA:
                title  = safe(intent.getStringExtra("title"));
                artist = safe(intent.getStringExtra("artist"));
                String al = safe(intent.getStringExtra("album"));
                album  = al.isEmpty() ? "VinaX" : al;
                artwork = decodeArtwork(intent.getStringExtra("artwork"));
                break;
            case ACTION_STATE:
                playing = intent.getBooleanExtra("playing", false);
                break;
            case ACTION_POSITION:
                long previousDuration = duration;
                duration = Math.round(intent.getDoubleExtra("duration", 0) * 1000);
                position = Math.round(intent.getDoubleExtra("position", 0) * 1000);
                float s  = (float) intent.getDoubleExtra("speed", 1.0);
                speed    = s <= 0 ? 1f : s;
                // Position ticks arrive every second: only the PlaybackState
                // moves. Rebuilding the notification, the widget and the
                // metadata bitmap each tick is wasted work — the notification
                // reads its progress from the session. Metadata carries the
                // duration, so it is re-sent only when that changed.
                if (duration != previousDuration) updateMetadata();
                updatePlaybackState();
                if (!foreground) promote();
                return;
            case ACTION_PLAY:  relay("play");          playing = true;  break;
            case ACTION_PAUSE: relay("pause");         playing = false; break;
            case ACTION_TOGGLE:
                if (playing) { relay("pause"); playing = false; }
                else         { relay("play");  playing = true;  }
                break;
            case ACTION_PREV:  relay("previoustrack"); break;
            case ACTION_NEXT:  relay("nexttrack");     break;
            case ACTION_STOP:
            case ACTION_STOP_SELF:
                relay("stop");
                playing = false;
                started = false;
                stopForegroundCompat();
                VinaxPlayerWidget.clear(this);
                stopSelf();
                return;
            default: break;
        }
        updateSession();
        promote();
        // v5.9.0 — mirror every change onto the home-screen widget.
        VinaxPlayerWidget.push(this, title, artist, artwork, playing);
    }

    private void updateSession() {
        updateMetadata();
        updatePlaybackState();
    }

    private void updateMetadata() {
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,  album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        if (artwork != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(md.build());
    }

    private void updatePlaybackState() {
        long actions = PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_PLAY  | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
                | PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                    playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    position, speed)
                .build());
    }

    private Notification buildNotification() {
        PendingIntent content = null;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            // Tapping the notification body opens the full-screen player.
            launch.putExtra(EXTRA_OPEN_PLAYER, true);
            content = PendingIntent.getActivity(this, 0, launch, piFlags());
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title.isEmpty() ? "VinaX" : title)
                .setContentText(artist)
                .setSubText(album)
                .setSmallIcon(R.drawable.vinax_ic_note)
                .setLargeIcon(artwork)
                .setContentIntent(content)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setOngoing(playing)
                .setShowWhen(false)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                // Android 12 may hold a fresh foreground notification back for
                // ten seconds; media controls must show at once.
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

        b.addAction(new NotificationCompat.Action(
                R.drawable.vinax_ic_prev, "Previous", pi(ACTION_PREV)));
        if (playing) {
            b.addAction(new NotificationCompat.Action(
                    R.drawable.vinax_ic_pause, "Pause", pi(ACTION_PAUSE)));
        } else {
            b.addAction(new NotificationCompat.Action(
                    R.drawable.vinax_ic_play, "Play", pi(ACTION_PLAY)));
        }
        b.addAction(new NotificationCompat.Action(
                R.drawable.vinax_ic_next, "Next", pi(ACTION_NEXT)));

        b.setStyle(new MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    /**
     * Always startForeground(): posting the notification any other way is
     * dropped by several vendor skins, and a service started through
     * startForegroundService() must call it anyway. Re-calling it on an
     * already-foreground service only refreshes the notification.
     *
     * Android 12+ refuses to bring a service INTO the foreground while the
     * app is in the background (ForegroundServiceStartNotAllowedException).
     * That can only happen here when the service was not foreground yet —
     * the fallback posts a plain notification so the controls still exist,
     * and the plugin asks the WebView to re-send everything on resume.
     */
    private void promote() {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
            foreground = true;
        } catch (Exception e) {
            foreground = false;
            Log.w(TAG, "startForeground refused: " + e.getMessage());
            if (plugin != null) plugin.noteForegroundRefused();
            try {
                NotificationManagerCompat.from(this).notify(NOTIF_ID, n);
            } catch (Exception ignored) {
                /* no notification permission — nothing more can be shown */
            }
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }
        try {
            NotificationManagerCompat.from(this).cancel(NOTIF_ID);
        } catch (Exception ignored) {
        }
        foreground = false;
        if (session != null) session.setActive(false);
    }

    private PendingIntent pi(String action) {
        Intent i = new Intent(this, VinaxMediaService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode() & 0xffff, i, piFlags());
    }

    private int piFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // LOW: shown, silent, no heads-up — the importance every media
            // notification uses. Never raise it; the system would beep.
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, getString(R.string.vinax_playback_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Bitmap decodeArtwork(String src) {
        if (src == null || src.isEmpty()) return artwork;
        try {
            int idx = src.indexOf(";base64,");
            if (idx != -1) {
                byte[] data = Base64.decode(src.substring(idx + 8), Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(data, 0, data.length);
            }
        } catch (Exception e) {
            Log.w(TAG, "artwork decode failed: " + e.getMessage());
        }
        return artwork;
    }

    private static String safe(String s) { return s == null ? "" : s; }

    /**
     * The app was swiped away from recents: the WebView (and the audio) is
     * gone, so a lingering "playing" notification and widget would control
     * nothing. Tear the foreground service down with it.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        playing = false;
        started = false;
        stopForegroundCompat();
        VinaxPlayerWidget.clear(this);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        started = false;
        if (instance == this) instance = null;
        if (noisyReceiver != null) {
            try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) { }
            noisyReceiver = null;
        }
        if (session != null) session.release();
        super.onDestroy();
        VinaxPlayerWidget.clear(this);
    }

    /* ── MediaBrowserServiceCompat ─────────────────────────────────────── */

    @Nullable
    @Override
    public BrowserRoot onGetRoot(
            @NonNull String clientPackageName,
            int clientUid,
            @Nullable Bundle rootHints) {
        /*
         * Return an empty BrowserRoot instead of null for non-trusted clients
         * (system UI, Bluetooth, vendor media controllers). Returning null
         * blocks them from connecting, which prevents the lock-screen and
         * notification controls from appearing on many devices.
         */
        if (isTrustedBrowserClient(clientPackageName, clientUid)) {
            return new BrowserRoot(ROOT_ID, null);
        }
        return new BrowserRoot("__empty__", null);
    }

    @Override
    public void onLoadChildren(
            @NonNull String parentId,
            @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        if ("__empty__".equals(parentId)) {
            result.sendResult(new ArrayList<>());
            return;
        }
        if (plugin != null) {
            result.detach();
            pendingResults.put(parentId, result);
            plugin.emitRequestChildren(parentId);
        } else {
            result.sendResult(new ArrayList<>());
        }
    }

    private boolean isTrustedBrowserClient(String clientPackageName, int clientUid) {
        if (clientUid == Process.myUid()
                || getPackageName().equals(clientPackageName)) return true;
        String[] packages = getPackageManager().getPackagesForUid(clientUid);
        if (packages == null
                || !Arrays.asList(packages).contains(clientPackageName)) return false;
        if (!isKnownMediaBrowserPackage(clientPackageName)) return false;
        if ("com.google.android.projection.gearhead".equals(clientPackageName)) return true;
        try {
            ApplicationInfo info =
                    getPackageManager().getApplicationInfo(clientPackageName, 0);
            int systemFlags = ApplicationInfo.FLAG_SYSTEM
                    | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP;
            return (info.flags & systemFlags) != 0;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private boolean isKnownMediaBrowserPackage(String pkg) {
        return "com.google.android.projection.gearhead".equals(pkg)
                || "com.google.android.gms".equals(pkg)
                || "com.google.android.googlequicksearchbox".equals(pkg)
                || "com.google.android.wearable.app".equals(pkg)
                || "com.android.car.media".equals(pkg)
                || "com.google.android.car.media".equals(pkg);
    }
}
