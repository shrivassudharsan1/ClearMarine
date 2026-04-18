import { useState, useRef, useEffect } from 'react';
import { triagePatient } from '../lib/gemini';
import { supabase } from '../lib/supabase';

function calcWaitTime(rooms, severityScore) {
  const total = rooms.length;
  if (total === 0) return '20–40 min';
  const occupied = rooms.filter((r) => r.is_occupied).length;
  const available = total - occupied;
  if (severityScore >= 8) return available > 0 ? 'Under 5 min' : '5–15 min';
  if (severityScore >= 5) return available > 1 ? '10–20 min' : '20–35 min';
  if (severityScore >= 3) return available > 0 ? '25–45 min' : '45–75 min';
  return available > 1 ? '45–90 min' : '90–120 min';
}

export default function PatientChatbot() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hello, I'm here to help assess your condition. Please describe your symptoms — what you're feeling, how long it's been happening, and how severe it is. You can type or tap the mic.",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [triageDone, setTriageDone] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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
      setInput(t);
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const stopVoice = () => { recognitionRef.current?.stop(); setListening(false); };

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setNameSubmitted(true);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const triage = await triagePatient(userMessage);

      // Fetch rooms for that dept to compute wait time
      const { data: rooms } = await supabase
        .from('rooms')
        .select('is_occupied')
        .eq('department', triage.recommended_department);

      const waitTime = calcWaitTime(rooms || [], triage.severity_score);

      await supabase.from('patients').insert({
        name,
        symptoms: userMessage,
        severity_score: triage.severity_score,
        severity_label: triage.severity_label,
        recommended_department: triage.recommended_department,
        department: triage.recommended_department,
        patient_instructions: triage.patient_instructions,
        clinical_summary: triage.clinical_summary,
        status: 'waiting',
        source_department: 'intake',
        handoff_status: 'none',
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: triage.patient_instructions,
          meta: {
            severity: triage.severity_label,
            score: triage.severity_score,
            department: triage.recommended_department,
            waitTime,
          },
        },
      ]);
      setTriageDone(true);
    } catch (err) {
      console.error('Triage error:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Unable to process symptoms. Please inform front desk staff immediately.', isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setName('');
    setNameSubmitted(false);
    setTriageDone(false);
    setMessages([{
      role: 'assistant',
      text: "Hello, I'm here to help assess your condition. Please describe your symptoms — what you're feeling, how long it's been happening, and how severe it is. You can type or tap the mic.",
    }]);
    setInput('');
  };

  const severityBadgeColor = (label) => {
    if (label === 'Critical') return 'bg-red-600 text-white';
    if (label === 'Urgent') return 'bg-orange-500 text-white';
    if (label === 'Moderate') return 'bg-yellow-500 text-black';
    return 'bg-green-600 text-white';
  };

  if (!nameSubmitted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md shadow-2xl border border-slate-700">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🏥</div>
            <h1 className="text-2xl font-bold text-white">ClearER</h1>
            <p className="text-slate-400 mt-1 text-sm">Patient Intake — AI Triage</p>
          </div>
          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Full name to begin</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors">
              Begin Triage
            </button>
          </form>
          <div className="mt-4 pt-4 border-t border-slate-700 text-center">
            <a href="/dashboard/ER" className="text-slate-500 text-xs hover:text-slate-300 transition-colors">
              Staff? Go to Dashboard →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <div className="text-2xl">🏥</div>
        <div>
          <h1 className="text-white font-bold">ClearER Triage</h1>
          <p className="text-slate-400 text-xs">Patient: {name}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 text-xs">Live</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs sm:max-w-sm md:max-w-md rounded-2xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : msg.isError
                ? 'bg-red-950 border border-red-700 text-red-200 rounded-bl-sm'
                : 'bg-slate-700 text-slate-100 rounded-bl-sm'
            }`}>
              <p className="text-sm leading-relaxed">{msg.text}</p>
              {msg.meta && (
                <div className="mt-3 pt-3 border-t border-slate-600 space-y-2">
                  <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${severityBadgeColor(msg.meta.severity)}`}>
                    {msg.meta.severity} — {msg.meta.score}/10
                  </span>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      Routing to: <span className="text-blue-400 font-medium">{msg.meta.department}</span>
                    </span>
                  </div>
                  <div className="bg-slate-800 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-400">Estimated wait</p>
                    <p className="text-white font-bold text-sm">{msg.meta.waitTime}</p>
                  </div>
                  <p className="text-xs text-green-400">✓ Staff notified</p>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {triageDone && (
        <div className="px-4 py-3 bg-slate-800 border-t border-slate-700">
          <button
            onClick={handleReset}
            className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-3 rounded-xl transition-colors text-sm"
          >
            ← New Patient / Back to Start
          </button>
        </div>
      )}

      {!triageDone && (
        <>
          {listening && (
            <div className="px-4 py-2 bg-red-950 border-t border-red-800 flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-300 text-xs">Listening... speak now. Tap mic to stop.</span>
            </div>
          )}
          <form onSubmit={handleSend} className="bg-slate-800 border-t border-slate-700 px-4 py-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Listening...' : 'Describe your symptoms...'}
              disabled={loading}
              className="flex-1 bg-slate-700 text-white placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={listening ? stopVoice : startVoice}
              disabled={loading}
              className={`px-3 py-2.5 rounded-xl transition-colors text-lg disabled:opacity-40 ${
                listening ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-slate-600 hover:bg-slate-500'
              }`}
            >
              🎤
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl transition-colors text-sm font-medium"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
