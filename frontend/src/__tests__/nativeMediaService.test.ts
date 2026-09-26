/**
 * The Java under native-android/ is copied into the Android project at build
 * time and is never compiled by this toolchain, so its contracts are pinned
 * at the string level: a refactor that drops one of these fails here instead
 * of shipping a notification that outlives the app, a service that misses
 * its foreground deadline, or a widget the launcher refuses.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeRoot = resolve(__dirname, '../../native-android');
const read = (name: string): string => readFileSync(resolve(nativeRoot, name), 'utf8');
const patchScript = readFileSync(resolve(__dirname, '../../scripts/patch-android.js'), 'utf8');

/** Body of the `case <label>:` block up to the next case label. */
function caseBody(src: string, label: string): string {
  const start = src.indexOf(`case ${label}:`);
  if (start === -1) return '';
  const rest = src.slice(start + label.length + 6);
  const next = rest.search(/\n\s*case\s/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Body of a Java method, from its opening brace to the matching close. */
function methodBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
}

const balanced = (src: string): void => {
  const count = (ch: string): number => src.split(ch).length - 1;
  expect(count('{')).toBe(count('}'));
  expect(count('(')).toBe(count(')'));
};

describe('VinaxMediaService', () => {
  const service = read('VinaxMediaService.java');

  it('tears the foreground service down when the task is swiped away', () => {
    const body = methodBody(service, 'public void onTaskRemoved(Intent rootIntent)');
    expect(body).toContain('playing = false;');
    expect(body).toContain('stopForegroundCompat();');
    expect(body).toContain('VinaxPlayerWidget.clear(this);');
    expect(body).toContain('stopSelf();');
    expect(body).toContain('super.onTaskRemoved(rootIntent);');
  });

  it('enters the foreground synchronously on every start, before handling the intent', () => {
    const body = methodBody(service, 'public int onStartCommand(Intent intent, int flags, int startId)');
    const promote = body.indexOf('if (!foreground) promote();');
    const handle = body.indexOf('handle(intent.getAction(), intent);');
    expect(promote).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(promote);
    expect(body).not.toContain('main.post(');
  });

  it('passes the mediaPlayback type to startForeground and survives a refusal', () => {
    const body = methodBody(service, 'private void promote()');
    expect(body).toContain('startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);');
    expect(body).toContain('catch (Exception e)');
    expect(body).toContain('foreground = false;');
    expect(body).toContain('plugin.noteForegroundRefused();');
    expect(body).toContain('NotificationManagerCompat.from(this).notify(NOTIF_ID, n);');
  });

  it('a position tick updates only the playback state and returns early', () => {
    const body = caseBody(service, 'ACTION_POSITION');
    expect(body).toContain('updatePlaybackState();');
    expect(body).toContain('if (duration != previousDuration) updateMetadata();');
    expect(body).toContain('if (!foreground) promote();');
    expect(body).toMatch(/return;\s*$/);
    expect(body).not.toContain('VinaxPlayerWidget.push');
  });

  it('a stop clears the widget, leaves the foreground and marks the service stopped', () => {
    const body = caseBody(service, 'ACTION_STOP_SELF');
    expect(body).toContain('relay("stop");');
    expect(body).toContain('started = false;');
    expect(body).toContain('stopForegroundCompat();');
    expect(body).toContain('VinaxPlayerWidget.clear(this);');
    expect(body).toContain('stopSelf();');
  });

  it('toggle decides play or pause from the service state (widget contract)', () => {
    expect(service).toContain('public static final String ACTION_TOGGLE = "vinax.TOGGLE";');
    const body = caseBody(service, 'ACTION_TOGGLE');
    expect(body).toContain('relay("pause")');
    expect(body).toContain('relay("play")');
  });

  it('keeps the public action strings the widgets and plugin use', () => {
    for (const [name, value] of [
      ['ACTION_METADATA', 'vinax.METADATA'],
      ['ACTION_STATE', 'vinax.STATE'],
      ['ACTION_POSITION', 'vinax.POSITION'],
      ['ACTION_STOP_SELF', 'vinax.STOP_SELF'],
      ['ACTION_PLAY', 'vinax.PLAY'],
      ['ACTION_PAUSE', 'vinax.PAUSE'],
      ['ACTION_PREV', 'vinax.PREV'],
      ['ACTION_NEXT', 'vinax.NEXT'],
    ]) {
      expect(service).toMatch(new RegExp(`public static final String ${name}\\s*=\\s*"${value.replace('.', '\\.')}";`));
    }
    expect(service).toContain('public static final String EXTRA_OPEN_PLAYER = "vinax.open.player";');
  });

  it('pauses when the audio output becomes noisy (headphones unplugged)', () => {
    expect(service).toContain('AudioManager.ACTION_AUDIO_BECOMING_NOISY');
    const body = methodBody(service, 'private void registerNoisyReceiver()');
    expect(body).toContain('relay("pause");');
    expect(body).toContain('Context.RECEIVER_NOT_EXPORTED');
    expect(methodBody(service, 'public void onDestroy()')).toContain('unregisterReceiver(noisyReceiver)');
  });

  it('uses a silent, low-importance channel and an immediate, silent media notification', () => {
    expect(service).toContain('NotificationManager.IMPORTANCE_LOW');
    const notif = methodBody(service, 'private Notification buildNotification()');
    expect(notif).toContain('.setOngoing(playing)');
    expect(notif).toContain('.setSilent(true)');
    expect(notif).toContain('.setCategory(NotificationCompat.CATEGORY_TRANSPORT)');
    expect(notif).toContain('.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)');
    expect(notif).toContain('.setSmallIcon(R.drawable.vinax_ic_note)');
    expect(notif).toContain('.setShowActionsInCompactView(0, 1, 2)');
  });

  it('exposes the live instance for the direct plugin path and clears it on destroy', () => {
    expect(service).toContain('public static volatile VinaxMediaService instance;');
    expect(methodBody(service, 'public void onCreate()')).toContain('instance = this;');
    expect(methodBody(service, 'public void onDestroy()')).toContain('if (instance == this) instance = null;');
    expect(service).toContain('public boolean isStarted()');
    expect(service).toContain('public void apply(final Intent intent)');
  });

  it('keeps balanced braces (cannot be compiled here)', () => {
    balanced(service);
  });
});

describe('VinaxMediaPlugin', () => {
  const plugin = read('VinaxMediaPlugin.java');

  it('drops the static service reference when this instance is destroyed', () => {
    expect(plugin).toContain('protected void handleOnDestroy()');
    expect(plugin).toContain('if (VinaxMediaService.plugin == this) VinaxMediaService.plugin = null;');
  });

  it('talks to a started service directly and survives a refused foreground start', () => {
    const body = methodBody(plugin, 'private boolean dispatch(Intent intent)');
    expect(body).toContain('if (live != null && live.isStarted())');
    expect(body).toContain('live.apply(intent);');
    expect(body).toContain('getContext().startForegroundService(intent);');
    expect(body).toContain('catch (Exception e)');
    expect(body).toContain('resyncNeeded = true;');
    expect(plugin).toContain('call.reject("fgs-start-not-allowed");');
  });

  it('asks the WebView to re-send its state when the activity resumes after a lost push', () => {
    const body = methodBody(plugin, 'protected void handleOnResume()');
    expect(body).toContain('emitAction("resync");');
    expect(plugin).toContain('public void noteForegroundRefused()');
  });

  it('stop with no live service only clears the widget instead of starting one', () => {
    const body = methodBody(plugin, 'public void stop(PluginCall call)');
    expect(body).toContain('VinaxPlayerWidget.clear(getContext());');
    expect(body).toContain('VinaxMediaService.ACTION_STOP_SELF');
  });

  it('keeps balanced braces (cannot be compiled here)', () => {
    balanced(plugin);
  });
});

describe('VinaxPlayerWidget', () => {
  const widget = read('VinaxPlayerWidget.java');

  it('keeps the push / clear contract the service relies on', () => {
    expect(widget).toContain('public static void push(Context context, String t, String a, Bitmap art, boolean isPlaying)');
    expect(widget).toContain('public static void clear(Context context)');
    expect(methodBody(widget, 'public static void clear(Context context)')).toContain('push(context, "", "", null, false);');
  });

  it('falls back to the quick-play deep link when the app process is gone', () => {
    const body = methodBody(widget, 'public void onReceive(Context context, Intent intent)');
    expect(body).toContain('if (VinaxMediaService.plugin == null)');
    expect(body).toContain('VinaxQuickPlayWidget.playIntent(context)');
    expect(body).toContain('VinaxMediaService.ACTION_TOGGLE');
    expect(body).toContain('context.startForegroundService(s);');
  });

  it('rounds the artwork and switches to the tall card from two rows up', () => {
    expect(widget).toContain('static Bitmap rounded(Bitmap src)');
    expect(widget).toContain('R.layout.vinax_widget_player_tall');
    expect(widget).toContain('AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT');
    expect(widget).toContain('public void onAppWidgetOptionsChanged(');
  });

  it('keeps balanced braces (cannot be compiled here)', () => {
    balanced(widget);
    balanced(read('VinaxQuickPlayWidget.java'));
  });
});

describe('VinaxQuickPlayWidget', () => {
  const widget = read('VinaxQuickPlayWidget.java');

  it('opens the app with the widget=play flag the web layer listens for', () => {
    expect(widget).toContain('?widget=play');
    expect(widget).toContain('public static PendingIntent playIntent(Context context)');
  });
});

describe('widget resources', () => {
  const info = (name: string): string => read(`res/xml/${name}`);
  const layout = (name: string): string => read(`res/layout/${name}`);

  it('the Now Playing provider is a resizable 4x1 home-screen widget with a preview and description', () => {
    const xml = info('vinax_player_widget_info.xml');
    expect(xml).toContain('android:resizeMode="horizontal|vertical"');
    expect(xml).toContain('android:targetCellWidth="4"');
    expect(xml).toContain('android:targetCellHeight="1"');
    expect(xml).toContain('android:widgetCategory="home_screen"');
    expect(xml).toContain('android:previewLayout="@layout/vinax_widget_player"');
    expect(xml).toContain('android:updatePeriodMillis="0"');
    expect(xml).toContain('android:description="@string/vinax_widget_player_desc"');
    expect(xml).toMatch(/android:minWidth="\d+dp"/);
    expect(xml).toMatch(/android:minHeight="\d+dp"/);
  });

  it('the quick-play provider matches', () => {
    const xml = info('vinax_widget_info.xml');
    expect(xml).toContain('android:widgetCategory="home_screen"');
    expect(xml).toContain('android:previewLayout="@layout/vinax_widget_quickplay"');
    expect(xml).toContain('android:updatePeriodMillis="0"');
    expect(xml).toContain('android:description="@string/vinax_widget_quickplay_desc"');
  });

  it('both Now Playing layouts expose the same ids the widget writes to', () => {
    for (const name of ['vinax_widget_player.xml', 'vinax_widget_player_tall.xml']) {
      const xml = layout(name);
      for (const id of ['vinax_wp_root', 'vinax_wp_art', 'vinax_wp_text', 'vinax_wp_title', 'vinax_wp_artist', 'vinax_wp_prev', 'vinax_wp_toggle', 'vinax_wp_next']) {
        expect(xml, `${name} lacks ${id}`).toContain(`android:id="@+id/${id}"`);
      }
      // RemoteViews cannot resolve theme attributes inside the launcher.
      expect(xml).not.toContain('?android:attr/');
      expect(xml).not.toContain('@android:drawable/');
    }
    expect(layout('vinax_widget_quickplay.xml')).toContain('android:id="@+id/vinax_widget_root"');
  });

  it('ships its own vector glyphs and strings', () => {
    for (const name of ['vinax_ic_play', 'vinax_ic_pause', 'vinax_ic_prev', 'vinax_ic_next', 'vinax_ic_note', 'vinax_widget_play_bg']) {
      expect(read(`res/drawable/${name}.xml`)).toContain('xmlns:android');
    }
    const strings = read('res/values/vinax_widgets.xml');
    for (const name of ['vinax_widget_player_label', 'vinax_widget_player_desc', 'vinax_widget_quickplay_label', 'vinax_widget_quickplay_desc', 'vinax_playback_channel']) {
      expect(strings).toContain(`<string name="${name}">`);
    }
  });
});

describe('scripts/patch-android.js', () => {
  it('declares every permission the service needs', () => {
    for (const p of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
    ]) {
      expect(patchScript).toContain(`<uses-permission android:name="${p}" />`);
    }
  });

  it('declares the typed, exported media service, the media-button receiver and both widgets', () => {
    expect(patchScript).toContain('android:foregroundServiceType="mediaPlayback"');
    expect(patchScript).toContain('android:name="androidx.media.session.MediaButtonReceiver" android:exported="true"');
    expect(patchScript).toContain('android:name=".VinaxQuickPlayWidget"');
    expect(patchScript).toContain('android:name=".VinaxPlayerWidget"');
    expect(patchScript).toContain('android:resource="@xml/vinax_player_widget_info"');
    expect(patchScript).toContain('android:resource="@xml/vinax_widget_info"');
  });

  it('keeps the WebView alive in onPause and onStop without overriding onResume', () => {
    const start = patchScript.indexOf('const mainActivity = `');
    const end = patchScript.indexOf('`;', start);
    const activity = patchScript.slice(start, end);
    expect(activity).toContain('public void onPause()');
    expect(activity).toContain('public void onStop()');
    expect(activity).not.toContain('public void onResume()');
    const keep = methodBody(activity, 'private void keepWebViewAlive()');
    expect(keep).toContain('getBridge().getWebView().onResume();');
    expect(keep).toContain('getBridge().getWebView().resumeTimers();');
    expect(activity).toContain('registerPlugin(VinaxMediaPlugin.class);');
  });
});
