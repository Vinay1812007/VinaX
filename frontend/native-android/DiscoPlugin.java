package __PKG__;

import android.app.Activity;
import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Disco lights (frontend/src/pages/DiscoPage.tsx) in the Android app:
 *
 *  - the phone's flashlight, flashed on the beat by the page. CameraManager's
 *    setTorchMode needs no CAMERA permission (API 23+) and never opens the
 *    camera, so it is quicker than the page's camera route and asks nothing;
 *  - the screen at full brightness for this window only (the system setting
 *    is untouched and comes back the moment the lights close);
 *  - the status and navigation bars hidden, so the lights fill the screen
 *    (a swipe from the edge shows them for a moment).
 *
 * Everything is put back when the page asks, when the app goes to the
 * background, and when the bridge dies. Registered in MainActivity by
 * scripts/patch-android.js. Checked against developer.android.com's
 * CameraManager, WindowManager.LayoutParams and WindowInsetsController
 * reference on 2026-11-17.
 */
@CapacitorPlugin(name = "VinaxDisco")
public class DiscoPlugin extends Plugin {

    private static final String TAG = "VinaxDisco";

    private String torchId = null;
    private boolean torchSearched = false;
    private boolean torchOn = false;
    private boolean bright = false;
    private boolean immersive = false;

    private CameraManager cameras() {
        return (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
    }

    /** The back camera with a flash, else any camera with one; null when the phone has none. */
    private String findTorch() {
        if (torchSearched) return torchId;
        torchSearched = true;
        try {
            CameraManager cm = cameras();
            String any = null;
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics c = cm.getCameraCharacteristics(id);
                Boolean flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (flash == null || !flash) continue;
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    torchId = id;
                    return torchId;
                }
                if (any == null) any = id;
            }
            torchId = any;
        } catch (Exception e) {
            Log.w(TAG, "no flashlight: " + e.getMessage());
            torchId = null;
        }
        return torchId;
    }

    @PluginMethod
    public void torchAvailable(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", findTorch() != null);
        call.resolve(out);
    }

    @PluginMethod
    public void torch(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        String id = findTorch();
        if (id == null) {
            call.reject("No flashlight on this phone");
            return;
        }
        try {
            cameras().setTorchMode(id, on);
            torchOn = on;
            call.resolve();
        } catch (CameraAccessException e) {
            // The camera is in use by another app: the flashlight is not ours to switch.
            call.reject("Flashlight busy", e);
        } catch (Exception e) {
            call.reject("Flashlight failed", e);
        }
    }

    /** { on: true } the screen at full brightness for this window; { on: false } the phone's own level again. */
    @PluginMethod
    public void brightness(PluginCall call) {
        final boolean on = call.getBoolean("on", false);
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No window");
            return;
        }
        activity.runOnUiThread(() -> {
            applyBrightness(activity, on);
            call.resolve();
        });
    }

    /** { hidden: true } status and navigation bars away (a swipe from the edge shows them for a moment); false brings them back. */
    @PluginMethod
    public void bars(PluginCall call) {
        final boolean hidden = call.getBoolean("hidden", false);
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No window");
            return;
        }
        activity.runOnUiThread(() -> {
            applyBars(activity, hidden);
            call.resolve();
        });
    }

    private void applyBrightness(Activity activity, boolean on) {
        try {
            Window window = activity.getWindow();
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.screenBrightness = on ? 1f : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            window.setAttributes(lp);
            bright = on;
        } catch (Exception e) {
            Log.w(TAG, "brightness: " + e.getMessage());
        }
    }

    private void applyBars(Activity activity, boolean hidden) {
        try {
            Window window = activity.getWindow();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController c = window.getInsetsController();
                if (c != null) {
                    if (hidden) {
                        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                        c.hide(WindowInsets.Type.systemBars());
                    } else {
                        c.show(WindowInsets.Type.systemBars());
                    }
                }
            } else {
                View decor = window.getDecorView();
                int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
                decor.setSystemUiVisibility(hidden ? flags : View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
            immersive = hidden;
        } catch (Exception e) {
            Log.w(TAG, "bars: " + e.getMessage());
        }
    }

    /** Flashlight off, brightness and bars back: the app left the foreground or the bridge is going. */
    private void restore() {
        if (torchOn && torchId != null) {
            try {
                cameras().setTorchMode(torchId, false);
            } catch (Exception ignored) {
                // Nothing else to do: Android turns it off when the camera service reclaims it.
            }
            torchOn = false;
        }
        final Activity activity = getActivity();
        if (activity != null && (bright || immersive)) {
            activity.runOnUiThread(() -> {
                if (bright) applyBrightness(activity, false);
                if (immersive) applyBars(activity, false);
            });
        }
    }

    @Override
    protected void handleOnPause() {
        // Only the flashlight: the window's brightness and bars belong to the
        // window, and the page asks for them again when it comes back.
        if (torchOn && torchId != null) {
            try {
                cameras().setTorchMode(torchId, false);
            } catch (Exception ignored) {
                // already off or not ours
            }
            torchOn = false;
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        restore();
        super.handleOnDestroy();
    }
}
