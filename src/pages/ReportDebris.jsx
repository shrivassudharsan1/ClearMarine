import { useState, useRef, useEffect } from 'react';
import { analyzeDebrisPhoto, analyzeDebrisText, notesLookSufficient } from '../lib/gemini';
import { supabase } from '../lib/supabase';
import { predictDrift } from '../lib/drift';
import { formatCoordPair, parseManualLongitude } from '../lib/coords';

export default function ReportDebris() {
  const [step, setStep] = useState('name'); // name | report | done
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState(null);       // { base64, mimeType, preview }
  const [location, setLocation] = useState(null); // { lat, lon }
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  /** Unsigned manual lon uses this (default W — Pacific Americas). */
  const [manualLonHemisphere, setManualLonHemisphere] = useState('W');
  const [locMode, setLocMode] = useState('auto'); // auto | manual
  const [loading, setLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [listening, setListening] = useState(false);
  const [notes, setNotes] = useState('');
  const fileRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (locMode === 'auto') {
      setLocLoading(true);
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          setLocLoading(false);
        },
        () => {
          setLocMode('manual');
          setLocLoading(false);
        }
      );
    }
  }, [locMode]);

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(',')[1];
      setPhoto({ base64, mimeType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice not supported — try Chrome.'); return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join('');
      setNotes(t);
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const stopVoice = () => { recognitionRef.current?.stop(); setListening(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const lat = locMode === 'manual' ? parseFloat(manualLat) : location?.lat;
    const lon = locMode === 'manual'
      ? parseManualLongitude(manualLon, manualLonHemisphere === 'E' ? 'E' : 'W')
      : location?.lon;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      alert('Location required — enter valid latitude and longitude.');
      return;
    }
    setLoading(true);
    try {
      let analysis = photo
        ? await analyzeDebrisPhoto(photo.base64, photo.mimeType, lat, lon)
        : await analyzeDebrisText(notes, lat, lon);

      if (photo && notesLookSufficient(notes)) {
        analysis = {
          ...analysis,
          needs_more_info: false,
          confidence: analysis.confidence === 'low' ? 'medium' : analysis.confidence,
        };
      }

      if (analysis.needs_more_info === true) {
        const proceed = window.confirm(
          'The AI could not fully verify details from this report (photo or notes may be vague).\n\n'
          + 'Are you sure you want to submit this sighting anyway?\n\n'
          + 'OK = save to the system. Cancel = go back and add more detail.',
        );
        if (!proceed) {
          setLoading(false);
          return;
        }
      }

      const drift = await predictDrift(lat, lon);

      const { data: sighting, error } = await supabase
        .from('debris_sightings')
        .insert({
          reporter_name: name,
          latitude: lat,
          longitude: lon,
          debris_type: analysis.debris_type,
          density_score: analysis.density_score,
          density_label: analysis.density_label,
          estimated_volume: analysis.estimated_volume,
          gemini_analysis: notes ? `${analysis.gemini_analysis} Reporter notes: ${notes}` : analysis.gemini_analysis,
          status: 'reported',
          jurisdiction: 'ClearMarine Operations',
          source_jurisdiction: 'public',
          handoff_status: 'none',
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('drift_predictions').insert({
        sighting_id: sighting.id,
        lat_24h: drift.predictions[0].lat,
        lon_24h: drift.predictions[0].lon,
        lat_48h: drift.predictions[1].lat,
        lon_48h: drift.predictions[1].lon,
        lat_72h: drift.predictions[2].lat,
        lon_72h: drift.predictions[2].lon,
        current_speed: drift.speed,
        current_bearing: drift.bearing,
      });

      setResult({ analysis, drift, lat, lon });
      setStep('done');
    } catch (err) {
      console.error(err);
      alert(`Error: ${err.message || 'Submission failed — check console for details.'}`);
    } finally {
      setLoading(false);
    }
  };

  const densityColor = (label) => {
    if (label === 'Unverified') return 'bg-slate-600 text-slate-100';
    if (label === 'Critical') return 'bg-red-600 text-white';
    if (label === 'Dense') return 'bg-orange-500 text-white';
    if (label === 'Moderate') return 'bg-yellow-500 text-black';
    return 'bg-green-600 text-white';
  };

  if (step === 'name') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md shadow-2xl border border-slate-700">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🌊</div>
            <h1 className="text-2xl font-bold text-white">ClearMarine</h1>
            <p className="text-slate-400 mt-1 text-sm">Ocean Debris Reporting System</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep('report'); }} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Your name or vessel ID</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Patrol Officer Chen / MV Seabird"
                className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
              />
            </div>
            <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 rounded-xl transition-colors">
              Report Debris Sighting
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-700 text-center">
            <a href="/dashboard" className="text-slate-500 text-xs hover:text-slate-300 transition-colors">
              Coordinator? Go to Dashboard →
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'done' && result) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700 shadow-2xl">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">✅</div>
            <h2 className="text-white font-bold text-xl">Sighting Reported</h2>
            <p className="text-slate-400 text-sm">Cleanup crews have been notified</p>
          </div>

          <div className="bg-slate-700 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${densityColor(result.analysis.density_label)}`}>
                {result.analysis.density_label} — {result.analysis.density_score}/10
              </span>
              <span className="text-xs bg-slate-600 text-slate-200 px-2 py-0.5 rounded-full capitalize">
                {result.analysis.debris_type.replace('_', ' ')}
              </span>
              <span className="text-xs text-slate-400">
                {result.analysis.estimated_volume === 'unknown' ? 'Volume not estimated' : result.analysis.estimated_volume}
              </span>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">{result.analysis.gemini_analysis}</p>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 mb-4">
            <p className="text-slate-400 text-xs mb-2 font-medium uppercase tracking-wider">Predicted Drift Path</p>
            <div className="space-y-1.5">
              {result.drift.predictions.map((p) => (
                <div key={p.hours} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">+{p.hours}h</span>
                  <span className="text-cyan-400 font-mono">{formatCoordPair(p.lat, p.lon)}</span>
                </div>
              ))}
            </div>
            <p className="text-slate-500 text-xs mt-2">
              Current: {result.drift.speed.toFixed(2)} knots at {result.drift.bearing.toFixed(0)}°
            </p>
            <p className={`text-xs mt-1 leading-snug ${result.drift.source.includes('Spray') ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              Drift driver: {result.drift.source}
            </p>
          </div>

          <button
            onClick={() => {
              setStep('name');
              setName('');
              setPhoto(null);
              setNotes('');
              setResult(null);
              setLocation(null);
              setManualLat('');
              setManualLon('');
              setManualLonHemisphere('W');
            }}
            className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-3 rounded-xl transition-colors text-sm"
          >
            ← Report Another Sighting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl">🌊</span>
        <div>
          <h1 className="text-white font-bold">ClearMarine — Report Sighting</h1>
          <p className="text-slate-400 text-xs">Reporter: {name}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          <span className="text-cyan-400 text-xs">Live</span>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto p-4 space-y-4">
        {/* Photo upload */}
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
          <p className="text-slate-300 text-sm font-medium mb-3">Debris Photo</p>
          {photo ? (
            <div className="relative">
              <img src={photo.preview} alt="Debris" className="w-full h-48 object-cover rounded-xl" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="absolute top-2 right-2 bg-slate-900 bg-opacity-80 text-white text-xs px-2 py-1 rounded-lg"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current.click()}
              className="w-full h-40 border-2 border-dashed border-slate-600 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-cyan-500 transition-colors"
            >
              <span className="text-3xl">📷</span>
              <span className="text-slate-400 text-sm">Tap to upload or take photo</span>
              <span className="text-slate-600 text-xs">JPG, PNG, HEIC supported</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        </div>

        {/* Location */}
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-300 text-sm font-medium">Location</p>
            <div className="flex gap-1">
              <button type="button" onClick={() => setLocMode('auto')} className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${locMode === 'auto' ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'}`}>Auto GPS</button>
              <button type="button" onClick={() => setLocMode('manual')} className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${locMode === 'manual' ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'}`}>Manual</button>
            </div>
          </div>
          {locMode === 'auto' ? (
            locLoading ? (
              <p className="text-slate-400 text-sm">Detecting location...</p>
            ) : location ? (
              <p className="text-cyan-400 text-sm font-mono">
                {formatCoordPair(location.lat, location.lon)} ✓
              </p>
            ) : (
              <p className="text-red-400 text-sm">GPS unavailable — switch to Manual</p>
            )
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  step="any"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="Latitude (e.g. 34.05)"
                  className="flex-1 bg-slate-700 text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <div className="flex flex-1 gap-1 min-w-0">
                  <input
                    type="number"
                    step="any"
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    placeholder="Longitude (e.g. 120.4)"
                    className="min-w-0 flex-1 bg-slate-700 text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <select
                    value={manualLonHemisphere}
                    onChange={(e) => setManualLonHemisphere(e.target.value)}
                    className="shrink-0 bg-slate-700 text-white rounded-xl px-2 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    title="East or West — unsigned numbers use this"
                  >
                    <option value="W">W</option>
                    <option value="E">E</option>
                  </select>
                </div>
              </div>
              <p className="text-slate-500 text-xs leading-snug">
                Tip: For US West Coast, enter longitude magnitude and choose <span className="text-slate-400">W</span> (e.g. 120.4 + W = 120.4°W). Or type a signed value <span className="font-mono text-slate-400">-120.4</span> — sign overrides the menu.
              </p>
            </div>
          )}
        </div>

        {/* Voice / text notes */}
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <p className="text-slate-300 text-sm font-medium">Additional Notes <span className="text-slate-500">(optional)</span></p>
            <button
              type="button"
              onClick={listening ? stopVoice : startVoice}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${listening ? 'bg-red-600 animate-pulse text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              🎤 {listening ? 'Stop' : 'Voice'}
            </button>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe what you see — size, location landmarks, wildlife impact..."
            rows={3}
            className="w-full bg-slate-700 text-white placeholder-slate-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
          />
          {listening && <p className="text-red-400 text-xs mt-1">● Listening...</p>}
        </div>

        <button
          type="submit"
          disabled={loading || (locMode === 'auto' && !location)}
          className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white font-bold py-4 rounded-xl transition-colors text-base"
        >
          {loading ? 'Analyzing with AI + Computing Drift...' : 'Submit Sighting Report'}
        </button>
      </form>
    </div>
  );
}
