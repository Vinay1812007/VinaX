package __PKG__;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.Spatializer;
import android.media.audiofx.AudioEffect;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * 1.19.2 — Settings › Sound and the Playback sheet show "Spatial audio" and
 * "Dolby Atmos" only on a phone that has them. This plugin answers what the
 * phone has; it changes nothing.
 *
 * Spatial audio: Android 12L+ (API 32) Spatializer. A phone whose immersive
 * level is not NONE can spatialise; isAvailable() says whether the current
 * output (usually headphones) can, isEnabled() whether the listener turned it
 * on in the phone's settings. VinaX's own spatial effect runs in the page
 * (services/audio/effects.ts); this only decides whether to offer it.
 *
 * Dolby Atmos: there is no public API to read or switch a phone's Dolby
 * processing, so the phone counts as having it when any of these is true:
 * an audio effect from Dolby is installed (AudioEffect.queryEffects), a
 * Dolby settings app is installed (declared in the manifest's <queries>, see
 * patch-android.js), or a decoder for Dolby Atmos audio (E-AC-3 JOC) exists.
 * openDolby() opens that Dolby app, or the phone's sound settings when there
 * is none (Samsung keeps Dolby Atmos there).
 *
 * Checked against developer.android.com's Spatializer, AudioEffect and
 * MediaCodecList reference on 2026-11-20.
 */
@CapacitorPlugin(name = "VinaxSoundCaps")
public class SoundCapsPlugin extends Plugin {

    private static final String TAG = "VinaxSoundCaps";

    /** Dolby's own settings apps on phones that ship one (Lenovo, Motorola, Realme, OnePlus, Nokia …). */
    static final String[] DOLBY_APPS = {
        "com.dolby.daxappui",
        "com.dolby.ds1appUI",
        "com.motorola.dolby.dolbyui",
        "com.dolby.atmos",
    };

    @PluginMethod
    public void caps(PluginCall call) {
        JSObject out = new JSObject();
        boolean spatial = false;
        boolean spatialAvailable = false;
        boolean spatialEnabled = false;
        try {
            if (Build.VERSION.SDK_INT >= 32) {
                AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
                Spatializer sp = am != null ? am.getSpatializer() : null;
                if (sp != null) {
                    spatial = sp.getImmersiveAudioLevel() != Spatializer.SPATIALIZER_IMMERSIVE_LEVEL_NONE;
                    spatialAvailable = sp.isAvailable();
                    spatialEnabled = sp.isEnabled();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "spatializer check failed", e);
        }
        out.put("spatial", spatial);
        out.put("spatialAvailable", spatialAvailable);
        out.put("spatialEnabled", spatialEnabled);

        String app = dolbyApp(getContext());
        boolean dolby = app != null || dolbyEffect() || atmosDecoder();
        out.put("dolby", dolby);
        out.put("dolbyApp", app != null);
        call.resolve(out);
    }

    @PluginMethod
    public void openDolby(PluginCall call) {
        Context ctx = getContext();
        try {
            String app = dolbyApp(ctx);
            Intent intent = app != null ? ctx.getPackageManager().getLaunchIntentForPackage(app) : null;
            if (intent == null) intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject out = new JSObject();
            out.put("opened", app != null ? "dolby" : "sound-settings");
            call.resolve(out);
        } catch (Exception e) {
            Log.w(TAG, "openDolby failed", e);
            call.reject("open_failed");
        }
    }

    static String dolbyApp(Context ctx) {
        PackageManager pm = ctx.getPackageManager();
        for (String pkg : DOLBY_APPS) {
            try {
                if (pm.getLaunchIntentForPackage(pkg) != null) return pkg;
            } catch (Exception ignored) {
            }
        }
        return null;
    }

    static boolean dolbyEffect() {
        try {
            AudioEffect.Descriptor[] all = AudioEffect.queryEffects();
            if (all == null) return false;
            for (AudioEffect.Descriptor d : all) {
                String text = ((d.name == null ? "" : d.name) + " " + (d.implementor == null ? "" : d.implementor)).toLowerCase(Locale.ROOT);
                if (text.contains("dolby")) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    static boolean atmosDecoder() {
        try {
            MediaFormat f = MediaFormat.createAudioFormat("audio/eac3-joc", 48000, 6);
            return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(f) != null;
        } catch (Exception ignored) {
            return false;
        }
    }
}
