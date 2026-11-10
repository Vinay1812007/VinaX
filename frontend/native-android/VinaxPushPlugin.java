package __PKG__;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * The page's handle on VinaxPushService (1.12): the token Firebase holds for
 * this phone, the signed-in session for linked uploads, and a re-register.
 * Registered in MainActivity by scripts/patch-android.js.
 */
@CapacitorPlugin(name = "VinaxPush")
public class VinaxPushPlugin extends Plugin {
    /** App start: the phone registers its address with the server, page or no page. */
    @Override
    public void load() {
        VinaxPushService.refresh(getContext().getApplicationContext());
    }

    /** { token } — the current FCM token, so the page can upload it linked to the account. */
    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                JSObject ret = new JSObject();
                if (task.isSuccessful() && task.getResult() != null) {
                    ret.put("token", task.getResult());
                    call.resolve(ret);
                } else {
                    Exception e = task.getException();
                    call.reject("no token: " + (e != null ? e.getMessage() : "unknown"));
                }
            });
        } catch (Exception e) {
            call.reject("firebase unavailable: " + e.getMessage());
        }
    }

    /** { session } — the signed-in VinaX session (or '' on sign-out); native uploads carry it from now on. */
    @PluginMethod
    public void setSession(PluginCall call) {
        String session = call.getString("session", "");
        Context ctx = getContext().getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(VinaxPushService.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(VinaxPushService.KEY_SESSION, session == null ? "" : session).apply();
        VinaxPushService.refresh(ctx);
        call.resolve();
    }

    /** Register again now; resolves { token, result } with the last upload's answer. */
    @PluginMethod
    public void register(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        VinaxPushService.refresh(ctx);
        SharedPreferences prefs = ctx.getSharedPreferences(VinaxPushService.PREFS, Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("token", prefs.getString(VinaxPushService.KEY_TOKEN, ""));
        ret.put("result", prefs.getString(VinaxPushService.KEY_RESULT, ""));
        call.resolve(ret);
    }
}
