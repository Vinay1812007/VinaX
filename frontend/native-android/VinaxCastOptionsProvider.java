package __PKG__;

import android.content.Context;

import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;

import java.util.List;

/**
 * Google Cast settings for the Android app (VinaxCastPlugin.java). The Cast
 * framework reads this class's name from the manifest meta-data
 * com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME, which
 * scripts/patch-android.js writes.
 *
 *  - The receiver is Google's Default Media Receiver, the same one the
 *    website sends to (services/cast/index.ts:
 *    chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID), so a TV plays the
 *    same thing from either.
 *  - No Cast notification and no Cast media session: VinaxMediaService
 *    already owns the playback notification, the lock screen and the media
 *    buttons, and its play / pause reach the TV through the page (the
 *    page's cast intercepts). Two sessions would fight over the buttons.
 *  - Ending the session stops the TV too, like the website's Stop casting.
 *
 * Checked against the play-services-cast-framework 22.3.1 classes
 * (CastOptions.Builder, CastMediaOptions.Builder, OptionsProvider) on
 * 2026-11-17.
 */
public class VinaxCastOptionsProvider implements OptionsProvider {

    @Override
    public CastOptions getCastOptions(Context context) {
        CastMediaOptions media = new CastMediaOptions.Builder()
                .setNotificationOptions(null)
                .setMediaSessionEnabled(false)
                .build();
        return new CastOptions.Builder()
                .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
                .setStopReceiverApplicationWhenEndingSession(true)
                .setCastMediaOptions(media)
                .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}
