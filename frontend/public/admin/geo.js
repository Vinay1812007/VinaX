/* VinaX console — world map data and drawing (Live Now, Dashboard).
 * LAND is a 360×141 dot grid (1° steps, from 83°N), one bit per
 * cell, row by row, from Natural Earth 110m land via world-atlas 2.0.2
 * (public domain data; world-atlas is ISC, © Michael Bostock).
 * CENTROIDS are [lat, lon] for ISO-3166 country codes: the middle of each
 * country's largest land area, hand-placed for small places and for countries
 * whose middle falls far from where people live. Regenerate with
 * scratch tooling only if the grid size changes; nothing here is fetched. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h;
  var STEP = 1, TOP = 83, COLS = 360, ROWS = 141, CELL = 10;
  var LAND =
    'AAAAAAAAAAAAAAAA+P8HAID//x8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+//+P/9///wEAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD8///5//////8/AAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAPD//x/+' +
    '//////8DAAAA0H8AAAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAAAOMCf/4D///////8BAACA/wEAAAAAAAAAAPgOAAAAAAAAAAAA' +
    'AAAAAAAAAAA4gAzAf/j///////8AAAAAfg4AAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAPgAADj4L+D///////8BAAAAGAAAAAAA' +
    'AAAAAAB+AAAAAAAAAAAAAAAAAAAAAIzP4IMBAACA//////8AAAAAAAAAAAAAfwAAAO7/PwAAwAMAAAAAAAAAAAAAAAD4A7v/DwAA' +
    '/P////8AAAAAAAAAAADwAQAA+P//HwAAwI8DAAAAAAAAAAAAAH8AAOAAAAAA+P///38AAAAAAAAAAAA8AAAA+P//BwAAAAAAAAAA' +
    'AAAAAAAAgL8Dh/O89wAA4P///x8AAAAAAAAAAAAOAADg/////78fAAAAAAAAAAAAAAAAwO//hwf8/wEA4P///x8AAAAAAAAAAIAP' +
    'AJ7///////8PgP8DAAAAAwDAAQAAAMD/D/D4/x8AgP///z8AAAAAAPABAAAcgN////////////////9/AAD+/x8AloD/f/CA//8A' +
    '4P///x8AAAAAAP8DAAAAgN//////////////D8AAAAD/////////////////////////////HwAA/v//wWAAAAAAAAAAAAAAAGAA' +
    '+P//////////////////////////////BwAA8DgAAGAAAAAAAAAAAAAAAAAAgP//////////////////////////////AwAA4AwA' +
    'ADAAAAAAAAAAAAAAAAAAAPz/////////////////////////////AQCAHwAAAAAAAAAAAAAAAAAAAAAAj///////////////////' +
    '//////////9/AB6ADQAAAAAAAAAAAAAAAAAAAAAAAAD4///////////DA/gHAP8HAOAPAADA//n///////////////////////8/' +
    'AIT///////////8BAOAEAP4DAAAAAAD4P/7///////////////////////9/AMD//////////38A0AcCAPwDAAAAAAD+H/7/////' +
    '////////////////f/8HAID/3////////z8AwD8AAPgBAAAAAAD+H/7/////////////////////kP8AACD/98D//////x8AgD8I' +
    'AAAAAAAAAAD+fwj+//////////////////9/4AUAAAD0BwD+/////x8AwH8cAAAAAAAAAAC8P/j//////////////////wM4cAAA' +
    'AADAAQDA/////38AgP8/AAAAAAAAwACAH/D//////////////////wAAPAAAAABgBgCA//////8DgP9/AAAAAAAAwAMwD/7/////' +
    '////////////fwAAfwAAAAA4AAAA//////8fgP9/AAAAAAAAwAEwBv7/////////////////HwAAPwAAAAADAAAA/v//////4///' +
    'AwAAAAAAsAcwAP//////////////////DwAAPwAAAAAAAACA/P//////4///BwAAAAAAOA7g+///////////////////3wQADwAA' +
    'AAAAAAAA+P//////4///DwAAAAAAuA/+/////////////////////wUABwAAAAAAAAAA8P//////5///DwAAAAAAjB//////////' +
    '/////////////wUAAwAAAAAAAAAA8P//////////CQAAAAAAgN///////////////////////w0AAAAAAAAAAAAA8P////////8B' +
    'BAAAAAAAAOD//////////////////////w0AAAAAAAAAAAAAwP7//////38GPgAAAAAAAPz//////////////////////wQAAAAA' +
    'AAAAAAAAgP3//////78HfgAAAAAAAP///////////////////////wQAAAAAAAAAAAAAAP///////98HUAAAAAAAAPz/////+f//' +
    '////////////fwQAAAAAAAAAAAAAAP////////+PAAAAAAAAAPj///9j/B/+////////////PwAAAAAAAAAAAAAAAP////////85' +
    'AAAAAAAAAPj/+P/D/of/////////////HwQAAAAAAAAAAAAAAP///////38EAAAAAAAAAPjP+f8B+If/////////////DwwAAAAA' +
    'AAAAAAAAAP///////x8AAAAAAAAA+H/A4/8A4Af/////////////Ag8AAAAAAAAAAAAAAP///////x8AAAAAAAAA+H8Ah/9gwA/9' +
    '//////////8/AAEAAAAAAAAAAAAAAP///////wsAAAAAAAAA+B8AnP/++x/4//////////8/AAMAAAAAAAAAAAAAAP///////wMA' +
    'AAAAAAAA+A8wGI///z/+/////////88PAAMAAAAAAAAAAAAAAP///////wEAAAAAAAAA+A8AEIb//x/8/////////wMOAAMAAAAA' +
    'AAAAAAAAAP7//////wEAAAAAAAAA+AcABo7//x/8/////////wMegAEAAAAAAAAAAAAAAPz//////wAAAAAAAAAA6AMsBIT//3/8' +
    '/////////z8YwAEAAAAAAAAAAAAAAPz//////wAAAAAAAAAAQPB/AAAA/////////////w8c8AEAAAAAAAAAAAAAAPj//////wAA' +
    'AAAAAAAAwP9/ACAw/////////////wcc/wAAAAAAAAAAAAAAAOD/////PwAAAAAAAAAA4P8/AAAA/////////////w+ADAAAAAAA' +
    'AAAAAAAAAID/////HwAAAAAAAAAA+P//AACA/////////////x/AAQAAAAAAAAAAAAAAAID/////BwAAAAAAAAAA+P//Bw+A////' +
    '/////////z/AAAAAAAAAAAAAAAAAAAD5////BwAAAAAAAAAA/P//H//f/////////////z8AAAAAAAAAAAAAAAAAAAD5///HBwAA' +
    'AAAAAAAA/P///////9///////////z8AAAAAAAAAAAAAAAAAAADy/x8ABgAAAAAAAAAA/v///////4///////////z8AAAAAAAAA' +
    'AAAAAAAAAADk/wcABgAAAAAAAACA//////+f/5///////////x8AAAAAAAAAAAAAAAAAAADM/wcADAAAAAAAAADA//////8//z/u' +
    '/////////w8AAAAAAAAAAAAAAAAAAACQ/wcADAAAAAAAAADg//////8//j/g/////////w8AAAAAAAAAAAAAAAAAAAAQ/wMAAAAA' +
    'AAAAAADg//////9//v8IgP///////ycAAAAAAAAAAAAAAAAAAAAg/gMAAAAAAAAAAADw/////////P8fgP///////zMAAAAAAAAA' +
    'AAAAAAAAAAAA/AMADgAAAAAAAADw////////+P9/AP7//////xAAAAAAAAAAAAAQAAAAAAAA/AOAMAAAAAAAAAD4////////+f//' +
    'AP7/P///HwAAAAAAAAAAAAAAAAAAAAAA+AccwAAAAAAAAAD4////////+f9/AOz/B/9/BAAAAAAAAAAAAAAAAQAAAAAA/AcewAEA' +
    'AAAAAADw////////8f8/AOD/A/4/BAAAAAAAAAAAAAAAAAAAAAAA8A8OAHgAAAAAAADw////////4f8/AOD/Afw/AgAAAAAAAAAA' +
    'AAAAAAAAAAAA4P8PwBACAAAAAADw////////w/8PAOD/APw/ACAAAAAAAAAAAAAAAAAAAAAAAP8PAAAAAAAAAADw////////x/8H' +
    'AOA/APx/ADAAAAAAAAAAAAAAAAAAAAAAAMwHAAAAAAAAAAD4////////h/8AAMAfAMz/ADAAAAAAAAAAAAAAAAAAAAAAAID/AQAA' +
    'AAAAAAD4////////j38AAMAPAMD/ATAAAAAAAAAAAAAAAAAAAAAAAAD+AQAAAAAAAAD4////////vx8AAIAPAMD/AWAAAAAAAAAA' +
    'AAAAAAAAAAAAAADwAAAAAAAAAAD4/////////wEAAIAPAID+AaAAAAAAAAAAAAAAAAAAAAAAAADgABAAAAAAAADw////////fwAA' +
    'AIAPAMD4AQACAAAAAAAAAAAAAAAAAAAAAADAAO4AAAAAAADg/////////3gAAAAPAID4AEgBAAAAAAAAAAAAAAAAAAAAAADAAe8/' +
    'AAAAAADA/////////38AAAAHAABgAIAAAAAAAAAAAAAAAAAAAAAAAAAAO/9/AAAAAACA/////////z8AAAASAMAgAAACAAAAAAAA' +
    'AAAAAAAAAAAAAAAAzP//AQAAAACA/////////z8AAAAwAIAAAMADAAAAAAAAAAAAAAAAAAAAAAAAwP//AwAAAAAA/////////z8A' +
    'AAAwAAABAAADAAAAAAAAAAAAAAAAAAAAAAAAgP//BwAAAAAA/h/+/////x8AAAAAAAADAAMCAAAAAAAAAAAAAAAAAAAAAAAAgP//' +
    '/wAAAAAAOAb+/////w8AAAAAADgHgAcAAAAAAAAAAAAAAAAAAAAAAAAAgP///wEAAAAAAADg/////w8AAAAAAHAGwAMAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAwP///wEAAAAAAADA/////wcAAAAAAOAG8AEAAAAAAAAAAAAAAAAAAAAAAAAA4P///wEAAAAAAADA/////wEA' +
    'AAAAAMAL+AMAAAAAAAAAAAAAAAAAAAAAAAAA8P///wMAAAAAAADg/////wAAAAAAAIAH/icZAAAAAAAAAAAAAAAAAAAAAAAA8P//' +
    '/wMAAAAAAADg////fwAAAAAAAIAP/gEAAAAAAAAAAAAAAAAAAAAAAAAA+P///zcAAAAAAADg////PwAAAAAAAAAP/nmAAwAAAAAA' +
    'AAAAAAAAAAAAAAAA+P///38AAAAAAADg////HwAAAAAAAAAe/DkAYwAAAAAAAAAAAAAAAAAAAAAA8P////8PAAAAAADA////DwAA' +
    'AAAAAAA8+Cgw9wMIAAAAAAAAAAAAAAAAAAAA+P////8/AAAAAACA////DwAAAAAAAAA8AGAA/B8AAAAAAAAAAAAAAAAAAAAA+P//' +
    '//9/AAAAAAAA////BwAAAAAAAAAwAEgA4D8IAAAAAAAAAAAAAAAAAAAA+P//////AQAAAAAA////BwAAAAAAAABAAAAAxH8GAAAA' +
    'AAAAAAAAAAAAAAAA8P//////AQAAAAAA/v//BwAAAAAAAADAHwAAgH8AAAAAAAAAAAAAAAAAAAAA4P//////AQAAAAAA/v//BwAA' +
    'AAAAAAAAfAAAwM8ACAAAAAAAAAAAAAAAAAAA4P//////AQAAAAAA/v//BwAAAAAAAAAAAAACAIYBAAAAAAAAAAAAAAAAAAAAwP//' +
    '////AAAAAAAA/v//DwAAAAAAAAAAABABAAADAAAAAAAAAAAAAAAAAAAAwP////9/AAAAAAAA/P//DwAAAAAAAAAAAAAAAAQAAAAA' +
    'AAAAAAAAAAAAAAAAgP////8/AAAAAAAA/P//DwAAAAAAAAAAAAAAEgQAAAAAAAAAAAAAAAAAAAAAgP////8/AAAAAAAA/v//HyAA' +
    'AAAAAAAAAADAHwwAAAAAAAAAAAAAAAAAAAAAAP////8fAAAAAAAA////HzAAAAAAAAAAAADEDwwAAAAAAAAAAAAAAAAAAAAAAP//' +
    '//8fAAAAAAAA////HzgAAAAAAAAAAAD+DxwAAAAAAAAAAAAAAAAAAAAAAPz///8fAAAAAAAA////Dz4AAAAAAAAAAAD/Hx4AAAAA' +
    'AAAAAAAAAAAAAAAAAPD///8fAAAAAAAA////Bz8AAAAAAAAAAAD/fz4AAAAAAAAAAAAAAAAAAAAAAOD///8fAAAAAAAA////AR8A' +
    'AAAAAAAAAMD//z8AAABgAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA/v//AB8AAAAAAAAAAMD//z8AAAAAAAAAAAAAAAAAAAAAAMD/' +
    '//8PAAAAAAAA/v9/AB8AAAAAAAAAAPj///8AAAAAAAAAAAAAAAAAAAAAAMD///8HAAAAAAAA/v9/AA8AAAAAAAAAAP////8BAAIA' +
    'AAAAAAAAAAAAAAAAAMD///8HAAAAAAAA/P9/gA8AAAAAAAAAgP////8DAAQAAAAAAAAAAAAAAAAAAMD///8BAAAAAAAA/P//gA8A' +
    'AAAAAAAAwP////8HAAAAAAAAAAAAAAAAAAAAAMD//z8AAAAAAAAA/P//AAcAAAAAAAAA4P////8PAAAAAAAAAAAAAAAAAAAAAOD/' +
    '/w8AAAAAAAAA+P8/AAcAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAA' +
    'AAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA8P8fAAAA' +
    'AAAAAAAAwP////8/AAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA4P8PAAAAAAAAAAAAgP////8/AAAAAAAAAAAAAAAAAAAAAOD/' +
    '/wMAAAAAAAAA4P8HAAAAAAAAAAAAgP////8fAAAAAAAAAAAAAAAAAAAAAPD//wEAAAAAAAAAwP8DAAAAAAAAAAAAgP////8fAAAA' +
    'AAAAAAAAAAAAAAAAAPD//wAAAAAAAAAAwP8BAAAAAAAAAAAAAP8P/v8fAAAAAAAAAAAAAAAAAAAAAPD/fwAAAAAAAAAAwP8AAAAA' +
    'AAAAAAAAAP8A/P8PAAAAAAAAAAAAAAAAAAAAAPD/PwAAAAAAAAAAwAMAAAAAAAAAAAAAgA8A2P8HAAAAAAAAAAAAAAAAAAAAAPD/' +
    'AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA4P8HAAACAAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8DAAAE' +
    'AAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAMAAAAAAAAAAAAAAAAAPz/AwAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAP4AAAA4AAAAAAAAAAAAAAAAAPg/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAAAAAAAAPw/' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAPwXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAJ' +
    'AAAAAAAAAAAAAAAAAPwHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAIADAAAAAAAAAAAAAAAAAPgHAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAMAAAIABAAAAAAAAAAAAAAAAAPgHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAP4D' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAP4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgA' +
    'AAAAAAAAAAAAAAAAAPwBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP4DAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8BAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8A' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAH6AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANgAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAH' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  var CENTROIDS = {
    AD:[42.5,1.5],AE:[23.9,54.2],AF:[33.9,66.1],AG:[17.1,-61.8],AL:[41.1,20],AM:[40.2,45],AO:[-12.3,17.5],
    AR:[-35.2,-65.1],AT:[47.6,14.1],AU:[-25.6,134.4],AW:[12.5,-70],AX:[60.2,20],AZ:[40.3,47.7],BA:[44.2,17.8],
    BB:[13.2,-59.5],BD:[23.8,90.3],BE:[50.7,4.6],BG:[42.8,25.2],BH:[26,50.6],BI:[-3.4,29.9],BM:[32.3,-64.8],
    BN:[4.7,114.9],BO:[-16.7,-64.6],BR:[-10.8,-53.1],BS:[24.5,-77.9],BT:[27.4,90.5],BW:[-22.1,23.8],BY:[53.5,28],
    BZ:[17.2,-88.7],CA:[56,-100],CD:[-2.8,23.6],CF:[6.5,20.4],CG:[-0.8,15.1],CH:[46.8,8.1],CI:[7.6,-5.6],
    CL:[-33,-71],CM:[5.7,12.6],CN:[36.6,103.9],CO:[3.9,-73.1],CR:[10,-84.2],CU:[21.6,-79],CV:[15.1,-23.6],
    CW:[12.2,-69],CY:[34.9,33],CZ:[49.8,15.3],DE:[51.1,10.3],DJ:[11.8,42.5],DK:[56.2,9.3],DM:[15.4,-61.4],
    DO:[18.9,-70.5],BJ:[9.6,2.3],DZ:[28.2,2.6],EC:[-1.5,-78.4],EE:[58.6,25.8],EG:[26.5,29.8],EH:[24.3,-12.1],
    ER:[15.4,38.7],ES:[40.3,-3.6],ET:[8.7,39.6],FI:[64.5,26.2],FJ:[-16.4,11.6],FK:[-51.7,-59.4],FM:[6.9,158.2],
    FO:[62,-6.9],FR:[46.6,2.4],GA:[-0.6,11.7],GB:[53.5,-1.8],GD:[12.1,-61.7],GE:[42.2,43.5],
    GG:[49.45,-2.6],GH:[7.9,-1.2],GI:[36.1,-5.35],GL:[74.8,-41.5],GM:[13.5,-15.4],GN:[10.4,-11.1],GP:[16.2,-61.6],
    GQ:[1.6,10.4],GR:[39.3,22.6],GT:[15.7,-90.4],GU:[13.4,144.8],GW:[12,-15.1],GY:[4.8,-59],HK:[22.3,114.2],
    HN:[14.8,-86.6],HR:[45,16.6],HT:[18.9,-72.7],HU:[47.2,19.4],HV:[12.3,-1.8],ID:[-2.5,117],IE:[53.2,-8],
    IL:[31.5,35],IM:[54.2,-4.5],IN:[22.5,79],IQ:[33,43.8],IR:[32.5,54.3],IS:[65.1,-18.8],IT:[43.5,12.2],
    JE:[49.2,-2.1],JM:[18.1,-77.3],JO:[31.2,36.8],JP:[36.5,138.5],KE:[0.6,37.8],KG:[41.5,74.6],KH:[12.7,104.9],
    KI:[1.9,-157.4],KM:[-11.9,43.9],KN:[17.3,-62.7],KP:[40.1,127.2],KR:[36.4,127.8],KW:[29.3,47.6],
    KY:[19.3,-81.3],KZ:[48.2,67.3],LA:[18.4,103.7],LB:[33.9,35.9],LC:[13.9,-61],LI:[47.2,9.6],LK:[7.7,80.7],
    LR:[6.4,-9.4],LS:[-29.6,28.2],LT:[55.3,23.9],LU:[49.8,6.1],LV:[56.8,24.8],LY:[27,18],MA:[29.9,-8.4],
    MC:[43.7,7.4],MD:[47.2,28.4],ME:[42.8,19.3],MG:[-19.4,46.7],MH:[7.1,171.2],MK:[41.6,21.7],ML:[17.3,-3.5],
    MM:[21,96.5],MN:[46.8,102.9],MO:[22.2,113.5],MQ:[14.6,-61],MR:[20.2,-10.3],MT:[35.9,14.4],MU:[-20.2,57.5],
    MV:[3.2,73.2],MW:[-13.2,34.2],MX:[23.9,-102.6],MY:[3.8,102],MZ:[-17.2,35.5],NA:[-22.1,17.2],NC:[-21.3,165.5],
    NE:[17.3,9.3],NG:[9.5,8],NI:[12.8,-85],NL:[52.3,5.5],NO:[61.5,9],NP:[28.2,84],NR:[-0.5,166.9],NZ:[-41,174],
    OM:[20.6,56.1],PA:[8.5,-80.1],PE:[-9.2,-74.4],PF:[-17.6,-149.5],PG:[-6.6,144.3],PH:[12.5,122.5],PK:[30,69.4],
    PL:[52.1,19.3],PR:[18.2,-66.5],PS:[31.9,35.2],PT:[39.6,-8.1],PW:[7.5,134.6],PY:[-23.2,-58.4],QA:[25.3,51.2],
    RE:[-21.1,55.5],RO:[45.9,24.9],RU:[58,60],RW:[-2,29.9],SA:[24.1,44.5],SB:[-7.9,159.1],SC:[-4.7,55.5],
    SD:[16,29.9],SE:[62.8,16.6],SG:[1.35,103.8],SI:[46.1,14.9],SK:[48.7,19.5],SL:[8.5,-11.8],SM:[43.9,12.4],
    SN:[14.4,-14.5],SO:[4.8,45.7],SR:[4.1,-55.9],SS:[7.3,30.2],ST:[0.2,6.6],SV:[13.7,-88.9],SY:[35,38.5],
    SZ:[-26.5,31.4],TD:[15.3,18.6],TF:[-49.3,69.5],TG:[8.4,1],TH:[15,101],TJ:[38.6,71],TL:[-8.8,126],
    TM:[39.1,59.3],TN:[34.2,9.5],TO:[-21.2,-175.2],TR:[39,35.2],TT:[10.5,-61.3],TV:[-8.5,179.2],TW:[23.7,121],
    TZ:[-6.3,34.8],UA:[49.1,31.2],UG:[1.3,32.4],UK:[53.9,-2.7],US:[39.5,-98.5],UY:[-32.8,-56],UZ:[41.7,63.2],
    VA:[41.9,12.5],VC:[13.3,-61.2],VE:[7.2,-66.2],VN:[16.7,106.3],VU:[-15.2,166.9],WS:[-13.8,-172.1],
    XK:[42.6,20.9],YE:[15.9,47.5],RS:[44.2,20.8],ZA:[-29,25.1],ZM:[-13.4,27.7],ZW:[-18.9,29.8]
  };

  var NS = 'http://www.w3.org/2000/svg';
  var W = COLS * CELL, H = ROWS * CELL;
  var paths = {};

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  /** One path for the land dots ("M x y h0" + round caps draws a dot); every
      `stride`-th cell, so the whole world is not a grey smear. */
  function landD(stride) {
    if (paths[stride]) return paths[stride];
    var bin = atob(LAND), out = [];
    for (var r = 0; r < ROWS; r += stride) for (var c = 0; c < COLS; c += stride) {
      var i = r * COLS + c;
      if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) out.push('M' + (c * CELL + CELL / 2) + ' ' + (r * CELL + CELL / 2) + 'h0');
    }
    return (paths[stride] = out.join(''));
  }
  function hash(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  /** Map x/y for a country, with a steady nudge per city so cities in one
      country spread out. Places are approximate: the app only knows the city name. */
  function place(code, city) {
    var c = CENTROIDS[String(code || '').toUpperCase()];
    if (!c) return null;
    var lat = c[0], lon = c[1];
    if (city) { var k = hash(String(city).toLowerCase()); lat += ((k & 255) / 255 - 0.5) * 6; lon += (((k >> 8) & 255) / 255 - 0.5) * 6; }
    return { x: (lon + 180) / 360 * W, y: (TOP - lat) / STEP * CELL + CELL / 2 };
  }

  /** A box around the markers, same shape as the world (null: show the world). */
  function fitBox(list) {
    if (!list.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (g) { x0 = Math.min(x0, g.at.x); x1 = Math.max(x1, g.at.x); y0 = Math.min(y0, g.at.y); y1 = Math.max(y1, g.at.y); });
    var w = Math.max((x1 - x0) * 1.8, W * 0.3), hh = w * H / W;
    if (hh < (y1 - y0) * 1.8) { hh = (y1 - y0) * 1.8; w = hh * W / H; }
    if (w > W * 0.7) return null;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { x: Math.min(Math.max(cx - w / 2, 0), W - w), y: Math.min(Math.max(cy - hh / 2, 0), H - hh), w: w, h: hh };
  }

  /**
   * VX.worldMap(points, opts) → element. points: [{ country, city, count,
   * playing }]; points in one city are merged. opts.compact hides the list
   * beside the map. Markers grow with the number of people; a ring pulses
   * where someone is playing a song. Starts zoomed to the listeners when they
   * are all in one part of the world.
   */
  VX.worldMap = function (points, opts) {
    opts = opts || {};
    var groups = {}, unknown = 0;
    (points || []).forEach(function (p) {
      var at = place(p.country, p.city);
      if (!at) { unknown += Number(p.count) || 1; return; }
      var key = String(p.country).toUpperCase() + '|' + String(p.city || '').toLowerCase();
      var g = groups[key] || (groups[key] = { country: String(p.country).toUpperCase(), city: p.city || null, count: 0, playing: 0, at: at });
      g.count += Number(p.count) || 1;
      g.playing += Number(p.playing) || 0;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.count - a.count; });
    var max = list.reduce(function (m, g) { return Math.max(m, g.count); }, 1);
    var nameOf = function (g) { return [g.city, VX.fmt.country(g.country)].filter(Boolean).join(', '); };

    var world = { x: 0, y: 0, w: W, h: H }, near = fitBox(list), view = near || world;
    var land = svg('path', { class: 'wm-land' });
    var map = svg('svg', { class: 'wm-svg', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
    map.appendChild(land);
    var layer = h('div.wm-layer');
    function draw() {
      map.setAttribute('viewBox', [view.x, view.y, view.w, view.h].map(function (n) { return n.toFixed(1); }).join(' '));
      land.setAttribute('d', landD(view === world ? 2 : 1));
      VX.clear(layer);
      list.slice().reverse().forEach(function (g) {
        var x = (g.at.x - view.x) / view.w * 100, y = (g.at.y - view.y) / view.h * 100;
        if (x < -2 || x > 102 || y < -2 || y > 102) return;
        layer.appendChild(h('span.wm-pt' + (g.playing ? '.playing' : ''), {
          title: nameOf(g) + ' — ' + VX.fmt.plural(g.count, 'person', 'people') + (g.playing ? ', ' + g.playing + ' playing' : ''),
          style: { left: x.toFixed(2) + '%', top: y.toFixed(2) + '%', '--s': Math.round(10 + 14 * Math.sqrt(g.count / max)) + 'px' }
        }));
      });
    }
    var mapBox = h('div.wm-map', { role: 'img', 'aria-label': list.length ? 'World map of ' + VX.fmt.plural(list.length, 'place') + ' where people are listening' : 'World map: nobody is listening right now' }, map, layer);
    if (near) {
      var btn = h('button.btn.sm.ghost.wm-zoom', { type: 'button', onclick: function () {
        view = view === world ? near : world;
        btn.textContent = view === world ? 'Zoom to listeners' : 'Whole world';
        draw();
      } }, 'Whole world');
      mapBox.appendChild(btn);
    }
    draw();
    var wrap = h('div.wm' + (opts.compact ? '.compact' : ''), mapBox);
    if (!opts.compact) {
      var top = list.slice(0, 8);
      wrap.appendChild(h('div.wm-side',
        h('h4.subhead', 'Top places'),
        top.length ? h('ol.wm-list', top.map(function (g) {
          return h('li', h('span.wm-swatch' + (g.playing ? '.playing' : '')), h('span.wm-name', nameOf(g)), h('strong', VX.fmt.num(g.count)));
        })) : h('p.muted.small', 'Nobody is listening right now.'),
        unknown ? h('p.muted.small', VX.fmt.plural(unknown, 'person', 'people') + ' without a known country') : null,
        list.length ? h('p.muted.small', 'Dots show the country; places inside a country are approximate.') : null));
    }
    return wrap;
  };
  VX.worldMap.centroid = function (code) { var c = CENTROIDS[String(code || '').toUpperCase()]; return c ? c.slice() : null; };
})();
