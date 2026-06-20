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

  async function fetchFMI(fmisid) {
    const url = 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature'
      + '&storedquery_id=fmi::observations::weather::multipointcoverage'
      + '&fmisid=' + fmisid
      + '&parameters=ws_10min,wg_10min,winddirection';
    const r = await fetch(url);
    const txt = await r.text();

    // Parsitaan doubleOrNilReasonTupleList kuten Python-koodissa
    const match = txt.match(/doubleOrNilReasonTupleList[^>]*>([\s\S]*?)<\//);
    if (!match) throw new Error('Ei dataa fmisid=' + fmisid);

    const rows = match[1].trim().split('\n').map(r => r.trim().split(/\s+/));
    // Viimeisin rivi jossa kaikki arvot ovat valideja
    let last = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.length >= 3 && r.every(v => v !== 'NaN' && !isNaN(parseFloat(v)))) {
        last = r; break;
      }
    }
    if (!last) throw new Error('Kaikki NaN fmisid=' + fmisid);
    return { speed: parseFloat(last[0]), gust: parseFloat(last[1]), dir: parseFloat(last[2]) };
  }

  const [laru, melsu, harmaja, tapiola] = await Promise.allSettled([
    fetchLaru(),
    fetchFMI('100996'), // Kaivopuisto (lähinnä Melsu)
    fetchFMI('100539'), // Harmaja
    fetchFMI('101004'), // Tapiola
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
