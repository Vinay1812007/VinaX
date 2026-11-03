package __PKG__;

import android.app.Activity;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * VinaX AI Live voice: loudspeaker or earpiece, like a phone call.
 *
 * When the page opens the mic with echo cancellation, Chromium (the WebView)
 * switches the app to MODE_IN_COMMUNICATION, and the page's audio then plays
 * as call audio (AAUDIO_USAGE_VOICE_COMMUNICATION). That is what lets the
 * phone's echo canceller hear the voice and take it out of the mic. But on
 * Android 12+ Chromium never picks a device, so Android uses its call default,
 * the earpiece: the listener holding the phone in front of them hears almost
 * nothing. This plugin keeps communication mode (so the echo canceller keeps
 * working) and moves the call audio to the loudspeaker, or back to the
 * earpiece when the listener asks.
 *
 * API 31+: setCommunicationDevice / clearCommunicationDevice (the selection
 * lasts while the process lives, so it is always cleared on stop and when
 * the bridge dies). Older: setMode(MODE_IN_COMMUNICATION) + setSpeakerphoneOn.
 * A connected headset (wired, USB, Bluetooth) is left to Android at start.
 * The volume keys follow the call volume while a session is on.
 *
 * Needs MODIFY_AUDIO_SETTINGS, which scripts/patch-android.js declares.
 * Checked against developer.android.com's AudioManager / AudioDeviceInfo
 * reference on 2026-11-03.
 */
@CapacitorPlugin(name = "VinaxAudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final String TAG = "VinaxAudioRoute";

    private boolean active = false;
    private boolean savedSpeakerphone = false;

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        boolean speaker = call.getBoolean("speaker", true);
        try {
            AudioManager am = audio();
            if (!active) {
                savedSpeakerphone = am.isSpeakerphoneOn();
                active = true;
            }
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            volumeKeys(true);
            if (headsetConnected(am)) {
                // Android routes call audio to the headset by itself.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
                else am.setSpeakerphoneOn(false);
            } else {
                route(am, speaker);
            }
            call.resolve(routeInfo(am));
        } catch (Exception e) {
            Log.w(TAG, "start failed", e);
            call.reject("audio_route_failed");
        }
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = call.getBoolean("on", true);
        try {
            AudioManager am = audio();
            if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            route(am, on);
            call.resolve(routeInfo(am));
        } catch (Exception e) {
            Log.w(TAG, "setSpeaker failed", e);
            call.reject("audio_route_failed");
        }
    }

    @PluginMethod
    public void getRoute(PluginCall call) {
        try {
            call.resolve(routeInfo(audio()));
        } catch (Exception e) {
            call.reject("audio_route_failed");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        restore();
        call.resolve();
    }

    /** The WebView is going away: never leave the phone in call mode on the loudspeaker. */
    @Override
    protected void handleOnDestroy() {
        restore();
        super.handleOnDestroy();
    }

    private void restore() {
        if (!active) return;
        active = false;
        try {
            AudioManager am = audio();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
            else am.setSpeakerphoneOn(savedSpeakerphone);
            // The mic is closed by now (Chromium has already left communication
            // mode); only reset the mode if something left it on.
            if (am.getMode() == AudioManager.MODE_IN_COMMUNICATION) am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception e) {
            Log.w(TAG, "restore failed", e);
        }
        volumeKeys(false);
    }

    private void route(AudioManager am, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int want = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            AudioDeviceInfo device = null;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == want) { device = d; break; }
            }
            if (device != null) {
                if (!am.setCommunicationDevice(device)) Log.w(TAG, "setCommunicationDevice refused " + want);
            } else if (!speaker) {
                // No earpiece (a tablet): let Android choose.
                am.clearCommunicationDevice();
            }
        } else {
            am.setSpeakerphoneOn(speaker);
        }
    }

    private static boolean isHeadset(int type) {
        return type == AudioDeviceInfo.TYPE_WIRED_HEADSET
            || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
            || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || type == AudioDeviceInfo.TYPE_USB_HEADSET
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET);
    }

    private static boolean headsetConnected(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) if (isHeadset(d.getType())) return true;
            return false;
        }
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (isHeadset(d.getType()) || d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true;
        }
        return false;
    }

    private JSObject routeInfo(AudioManager am) {
        String route = "other";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo d = am.getCommunicationDevice();
            if (d != null) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) route = "speaker";
                else if (t == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) route = "earpiece";
                else if (isHeadset(t)) route = "headset";
            }
        } else if (am.isSpeakerphoneOn()) {
            route = "speaker";
        } else if (headsetConnected(am)) {
            route = "headset";
        } else {
            route = "earpiece";
        }
        JSObject ret = new JSObject();
        ret.put("route", route);
        return ret;
    }

    /** While a session is on, the volume keys change the call volume (the stream the voice plays on). */
    private void volumeKeys(final boolean inCall) {
        final Activity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> activity.setVolumeControlStream(inCall ? AudioManager.STREAM_VOICE_CALL : AudioManager.USE_DEFAULT_STREAM_TYPE));
    }
}
