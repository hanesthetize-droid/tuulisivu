export default async () => {
  const KN = 0.51444;

  async function fetchLaru() {
    const r = await fetch('https://larukite.fi/tuulibot/show_station_data_current.php');
    const d = await r.json();
    return {
      speed: parseFloat(d.wind_avg) * KN,
      gust:  parseFloat(d.wind_max) * KN,
      dir:   parseFloat(d.wind_direction),
    };
  }

  // Mellsten/Melsu: Surfing Ry:n oma sääasema, julkaisee suoraan m/s-tekstiä
  // Formaatti: " HH:MM dir°   min <  avg <  max   temp°C  paine  kosteus%  sade"
  async function fetchMelsten() {
    const r = await fetch('https://mellsten.surfing.fi/lastWeather.txt');
    const txt = (await r.text()).trim();
    // esim: "08:17 222°   3.7 <  4.3 <  4.8   14.7°C  1018.8  82.8%   0.0"
    const m = txt.match(/(\d+)°\s+([\d.]+)\s*<\s*([\d.]+)\s*<\s*([\d.]+)/);
    if (!m) throw new Error('Mellsten: parsinta epäonnistui: ' + txt.slice(0, 80));
    const [, dir, min, avg, max] = m;
    return {
      speed: parseFloat(avg),
      gust: parseFloat(max),
      dir: parseFloat(dir),
    };
  }

  async function fetchFMI(fmisid) {
    // HUOM: parametrit pyydetään ilman t2m:ää, joten datablokissa on
    // täsmälleen 3 saraketta: ws_10min, wg_10min, winddirection (tässä järjestyksessä)
    const url = 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
      + '&storedquery_id=fmi::observations::weather::multipointcoverage'
      + '&fmisid=' + fmisid
      + '&parameters=ws_10min,wg_10min,winddirection';
    const r = await fetch(url);
    const txt = await r.text();

    // Poimitaan aseman nimi FMI:n vastauksesta, jotta voimme tarkistaa
    // että fmisid vastaa sitä asemaa jota luulimme pyytävämme
    const nameMatch = txt.match(/locationcode\/name">([^<]+)</);
    const stationName = nameMatch ? nameMatch[1] : 'tuntematon';

    const idMatch = txt.match(/stationcode\/fmisid">(\d+)</);
    const returnedId = idMatch ? idMatch[1] : null;

    // Selvitetään sarakejärjestys swe:field-määrittelyistä (varman päälle)
    const fieldNames = [...txt.matchAll(/<swe:field name="(\w+)"/g)].map(m => m[1]);

    const match = txt.match(/doubleOrNilReasonTupleList[^>]*>([\s\S]*?)<\//);
    if (!match) throw new Error('Ei dataa fmisid=' + fmisid);

    const rows = match[1].trim().split('\n').map(r => r.trim().split(/\s+/));

    const wsIdx  = fieldNames.indexOf('ws_10min');
    const wgIdx  = fieldNames.indexOf('wg_10min');
    const dirIdx = fieldNames.indexOf('winddirection');
    if (wsIdx === -1 || dirIdx === -1) throw new Error('Sarakkeita ei tunnistettu fmisid=' + fmisid);

    // Viimeisin rivi jossa ws_10min ja winddirection ovat valideja
    let last = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.length > Math.max(wsIdx, wgIdx, dirIdx)
          && r[wsIdx] !== 'NaN' && !isNaN(parseFloat(r[wsIdx]))
          && r[dirIdx] !== 'NaN' && !isNaN(parseFloat(r[dirIdx]))) {
        last = r; break;
      }
    }
    if (!last) throw new Error('Kaikki rivit NaN fmisid=' + fmisid);

    const speed = parseFloat(last[wsIdx]);
    const gustRaw = wgIdx >= 0 ? parseFloat(last[wgIdx]) : NaN;
    return {
      speed,
      gust: isNaN(gustRaw) ? speed : gustRaw,
      dir: parseFloat(last[dirIdx]),
      _requestedFmisid: fmisid,
      _returnedFmisid: returnedId,
      _stationName: stationName,
    };
  }

  const [laru, melsu, harmaja, tapiola] = await Promise.allSettled([
    fetchLaru(),
    fetchMelsten(),     // Surfing Ry oma asema (vastaa Windguru 2399)
    fetchFMI('100996'), // Helsinki Harmaja (vahvistettu oikeaksi)
    fetchFMI('874863'), // Espoo Tapiola (vahvistettu oikeaksi)
  ]);

  const pick = r => r.status === 'fulfilled' ? r.value : null;

  return new Response(JSON.stringify({
    laru:    pick(laru),
    melsu:   pick(melsu),
    harmaja: pick(harmaja),
    tapiola: pick(tapiola),
    ts: Date.now(),
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    }
  });
};

export const config = { path: '/api/wind' };
