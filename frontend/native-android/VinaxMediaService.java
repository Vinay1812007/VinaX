package __PKG__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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
 * to support Android Auto and WearOS media browsing.
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
    private static final String ACTION_PLAY  = "vinax.PLAY";
    private static final String ACTION_PAUSE = "vinax.PAUSE";
    private static final String ACTION_PREV  = "vinax.PREV";
    private static final String ACTION_NEXT  = "vinax.NEXT";
    private static final String ACTION_STOP  = "vinax.STOP";
    private static final String ROOT_ID      = "vinax_root";

    public static VinaxMediaPlugin plugin;

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

    /* Pending browse result from a trusted Android Auto / Wear OS client. */
    public static final Map<String, Result<List<MediaBrowserCompat.MediaItem>>> pendingResults = new HashMap<>();

    @Override
    public void onCreate() {
        super.onCreate();
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
    }

    private void relay(String action) {
        if (plugin != null) plugin.emitAction(action);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        MediaButtonReceiver.handleIntent(session, intent);
        if (intent == null || intent.getAction() == null) {
            promoteIfNeeded();
            return START_NOT_STICKY;
        }
        final String action = intent.getAction();
        main.post(() -> handle(action, intent));
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
                duration = Math.round(intent.getDoubleExtra("duration", 0) * 1000);
                position = Math.round(intent.getDoubleExtra("position", 0) * 1000);
                float s  = (float) intent.getDoubleExtra("speed", 1.0);
                speed    = s <= 0 ? 1f : s;
                break;
            case ACTION_PLAY:  relay("play");          playing = true;  break;
            case ACTION_PAUSE: relay("pause");         playing = false; break;
            case ACTION_PREV:  relay("previoustrack"); break;
            case ACTION_NEXT:  relay("nexttrack");     break;
            case ACTION_STOP:
            case ACTION_STOP_SELF:
                relay("stop");
                stopForegroundCompat();
                stopSelf();
                return;
            default: break;
        }
        updateSession();
        promote();
    }

    private void updateSession() {
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,  album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        if (artwork != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(md.build());

        long actions = PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_PLAY  | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
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

        int iconId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
        if (iconId == 0) iconId = android.R.drawable.ic_media_play;

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title.isEmpty() ? "VinaX" : title)
                .setContentText(artist)
                .setSubText(album)
                .setSmallIcon(iconId)
                .setLargeIcon(artwork)
                .setContentIntent(content)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setShowWhen(false)
                .setOnlyAlertOnce(true);

        b.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_previous, "Previous", pi(ACTION_PREV)));
        if (playing) {
            b.addAction(new NotificationCompat.Action(
                    android.R.drawable.ic_media_pause, "Pause", pi(ACTION_PAUSE)));
        } else {
            b.addAction(new NotificationCompat.Action(
                    android.R.drawable.ic_media_play, "Play", pi(ACTION_PLAY)));
        }
        b.addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_next, "Next", pi(ACTION_NEXT)));

        b.setStyle(new MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    /**
     * FIX: Always call startForeground() — using NotificationManager.notify()
     * for foreground service notifications is unreliable on Android 12+ and
     * many OEM skins (Samsung One UI, MIUI). startForeground() must be called
     * on every update to correctly refresh the media notification.
     */
    private void promote() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, n);
        }
        foreground = true;
    }

    private void promoteIfNeeded() {
        main.post(() -> { updateSession(); promote(); });
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
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
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
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

    @Override
    public void onDestroy() {
        if (session != null) session.release();
        super.onDestroy();
    }

    /* ── MediaBrowserServiceCompat ─────────────────────────────────────── */

    @Nullable
    @Override
    public BrowserRoot onGetRoot(
            @NonNull String clientPackageName,
            int clientUid,
            @Nullable Bundle rootHints) {
        /*
         * FIX: Return an empty BrowserRoot instead of null for non-trusted
         * clients (system UI, Bluetooth, OEM media controllers).
         * Returning null blocks them from connecting, which prevents the
         * lock-screen and notification controls from appearing on many devices.
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
        /* FIX: Short-circuit for non-trusted clients that received __empty__ root. */
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
