package __PKG__;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

import org.json.JSONObject;

/**
 * VinaX push, done natively (1.12, "rebuild the push notifications").
 *
 * The WebView path (the Capacitor plugin firing a JS event, the page
 * uploading the token) produced no token for any phone in months: it
 * depended on the page, its permission flow and timing. This service is the
 * phone's own push address book:
 *
 *  - onNewToken / the plugin's load(): the FCM token is POSTed to
 *    /api/push/fcm-register from Java, with the signed-in session when the
 *    page handed one over (VinaxPushPlugin.setSession), no page needed.
 *  - onMessageReceived: a push that arrives while the app is open (or a
 *    data-only push at any time) is drawn here with the VinaX mark: the white
 *    V small icon in the accent colour and the colour logo (or the owner's
 *    picture) as the large icon. A push with a notification block that
 *    arrives while the app is closed is drawn by Android from the manifest
 *    defaults (same small icon, same colour, the logo from its image).
 *
 * This service takes the MESSAGING_EVENT intent with a higher priority than
 * the Capacitor plugin's, so it is the one Android calls. The plugin's JS
 * `register()` still answers with the token (it reads it from Firebase
 * itself), so the page can link the token to the account as before.
 */
public class VinaxPushService extends FirebaseMessagingService {
    static final String TAG = "VinaxPush";
    static final String CHANNEL_ID = "vinax_picks";
    static final String PREFS = "vinax_push";
    static final String KEY_SESSION = "session";
    static final String KEY_TOKEN = "token";
    static final String KEY_RESULT = "result";
    static final String REGISTER_URL = "https://www.vinaxmusic.online/api/push/fcm-register";
    static final String SITE = "https://www.vinaxmusic.online";
    static final String DEFAULT_IMAGE = SITE + "/icons/icon-512.png";
    static final int ACCENT = 0xFFFFA42E;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.i(TAG, "new token");
        upload(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        RemoteMessage.Notification n = message.getNotification();
        String title = n != null && n.getTitle() != null ? n.getTitle() : data.get("title");
        String body = n != null && n.getBody() != null ? n.getBody() : data.get("body");
        String image = n != null && n.getImageUrl() != null ? n.getImageUrl().toString() : data.get("image");
        String link = data.get("link");
        String id = data.get("id");
        if (title == null && body == null) return;
        show(getApplicationContext(), title, body, link, image, id);
    }

    /** Ask Firebase for the current token and upload it (app start, "Register again"). */
    static void refresh(final Context ctx) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    Exception e = task.getException();
                    remember(ctx, KEY_RESULT, "no token: " + (e != null ? e.getMessage() : "unknown"));
                    Log.w(TAG, "getToken failed", e);
                    return;
                }
                final String token = task.getResult();
                new Thread(() -> upload(ctx, token)).start();
            });
        } catch (Exception e) {
            remember(ctx, KEY_RESULT, "firebase unavailable: " + e.getMessage());
            Log.w(TAG, "refresh failed", e);
        }
    }

    /** POST the token to the Worker. Runs on the calling thread (always a background one). */
    static void upload(Context ctx, String token) {
        if (token == null || token.length() < 20) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_TOKEN, token).apply();
        HttpURLConnection conn = null;
        try {
            JSONObject json = new JSONObject();
            json.put("token", token);
            json.put("platform", "android");
            json.put("lang", Locale.getDefault().toLanguageTag());
            json.put("tzOffset", TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000);
            byte[] payload = json.toString().getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(REGISTER_URL).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("x-vinax-platform", "android");
            conn.setRequestProperty("x-vinax-version", appVersion(ctx));
            String session = prefs.getString(KEY_SESSION, null);
            if (session != null && session.startsWith("vx1.")) conn.setRequestProperty("Authorization", "Bearer " + session);
            try (OutputStream out = conn.getOutputStream()) { out.write(payload); }
            int status = conn.getResponseCode();
            String text = read(status < 400 ? conn.getInputStream() : conn.getErrorStream());
            remember(ctx, KEY_RESULT, status + " " + (text.length() > 120 ? text.substring(0, 120) : text));
            Log.i(TAG, "fcm-register " + status);
        } catch (Exception e) {
            remember(ctx, KEY_RESULT, "upload failed: " + e.getMessage());
            Log.w(TAG, "upload failed", e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static void remember(Context ctx, String key, String value) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, value == null ? "" : value).apply();
    }

    static String read(InputStream in) {
        if (in == null) return "";
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null && sb.length() < 2000) sb.append(line);
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    static String appVersion(Context ctx) {
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return p.versionName + "+" + (Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode);
        } catch (Exception e) {
            return "unknown";
        }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Song picks & news", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Your daily song picks and messages from VinaX");
        ch.enableLights(true);
        ch.setLightColor(ACCENT);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    /** Draw one push with the VinaX mark. */
    static void show(Context ctx, String title, String body, String link, String image, String id) {
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (link != null && link.startsWith("/") && !link.startsWith("//")) open.putExtra("vinax_link", link);
        if (id != null) open.putExtra("vinax_push_id", id);
        int code = (int) (System.currentTimeMillis() & 0x7fffffff);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(ctx, code, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.vinax_ic_notify)
            .setColor(ACCENT)
            .setContentTitle(title != null ? title : "VinaX")
            .setContentText(body != null ? body : "")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(tap);
        if (body != null) b.setStyle(new NotificationCompat.BigTextStyle().bigText(body));

        Bitmap logo = BitmapFactory.decodeResource(ctx.getResources(), R.drawable.vinax_ic_large);
        Bitmap picture = image != null && image.startsWith("https://") && !image.equals(DEFAULT_IMAGE) ? fetchBitmap(image) : null;
        if (picture != null) {
            b.setLargeIcon(logo != null ? logo : picture);
            b.setStyle(new NotificationCompat.BigPictureStyle().bigPicture(picture).setSummaryText(body));
        } else if (logo != null) {
            b.setLargeIcon(logo);
        }
        try {
            NotificationManagerCompat.from(ctx).notify(code, b.build());
        } catch (SecurityException e) {
            Log.w(TAG, "no notification permission", e);
        }
    }

    static Bitmap fetchBitmap(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            try (InputStream in = conn.getInputStream()) {
                return BitmapFactory.decodeStream(in);
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
