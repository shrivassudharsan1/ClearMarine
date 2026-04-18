import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function RoomStatus() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [supplies, setSupplies] = useState([]);
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [adjusting, setAdjusting] = useState(null);

  const fetchSupplies = useCallback(async (dept) => {
    const { data } = await supabase.from('supplies').select('*').eq('department', dept).order('name');
    if (data) setSupplies(data);
  }, []);

  const fetchPatient = useCallback(async (patientId) => {
    if (!patientId) { setPatient(null); return; }
    const { data } = await supabase.from('patients').select('*').eq('id', patientId).single();
    setPatient(data);
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.from('rooms').select('*').eq('id', roomId).single();
      setRoom(data);
      setLoading(false);
      if (data) {
        await fetchSupplies(data.department);
        await fetchPatient(data.current_patient);
      }
    };
    init();

    const roomChan = supabase
      .channel('room-detail-' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (payload) => {
        setRoom(payload.new);
        fetchPatient(payload.new.current_patient);
      })
      .subscribe();

    return () => supabase.removeChannel(roomChan);
  }, [roomId, fetchSupplies, fetchPatient]);

  // Realtime supply updates
  useEffect(() => {
    if (!room?.department) return;
    const supChan = supabase
      .channel('supplies-room-' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplies' }, () => fetchSupplies(room.department))
      .subscribe();
    return () => supabase.removeChannel(supChan);
  }, [room?.department, roomId, fetchSupplies]);

  const toggleOccupied = async () => {
    if (!room) return;
    setToggling(true);
    const newOccupied = !room.is_occupied;
    await supabase.from('rooms').update({
      is_occupied: newOccupied,
      current_patient: newOccupied ? room.current_patient : null,
      updated_at: new Date().toISOString(),
    }).eq('id', roomId);
    if (!newOccupied) setPatient(null);
    setToggling(false);
  };

  const adjustSupply = async (supply, delta) => {
    const newQty = Math.max(0, supply.quantity + delta);
    setAdjusting(supply.id);
    await supabase.from('supplies').update({ quantity: newQty, updated_at: new Date().toISOString() }).eq('id', supply.id);
    setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, quantity: newQty } : s));
    setAdjusting(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading room...</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Room not found</p>
      </div>
    );
  }

  const lowSupplies = supplies.filter((s) => s.quantity <= s.low_threshold);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏥</span>
          <div>
            <h1 className="text-white font-bold">{room.room_name}</h1>
            <p className="text-slate-400 text-xs">{room.department} — Nurse Station</p>
          </div>
        </div>
        <a href={`/dashboard/${room.department}`} className="text-blue-400 text-sm hover:underline">
          ← Dashboard
        </a>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {/* Low supply priority banner */}
        {lowSupplies.length > 0 && (
          <div className="bg-red-900 border border-red-600 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-red-200 font-bold text-sm">PRIORITY — Low Supplies</p>
              <p className="text-red-300 text-xs">{lowSupplies.map((s) => s.name).join(', ')} critically low</p>
            </div>
          </div>
        )}

        {/* Room status */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 text-center">
          <div className="text-5xl mb-3">{room.is_occupied ? '🔴' : '🟢'}</div>
          <div className={`inline-block px-5 py-1.5 rounded-full text-base font-bold mb-4 ${room.is_occupied ? 'bg-red-700 text-white' : 'bg-green-700 text-white'}`}>
            {room.is_occupied ? 'OCCUPIED' : 'AVAILABLE'}
          </div>

          {patient && room.is_occupied && (
            <div className="bg-slate-700 rounded-xl p-3 mb-4 text-left">
              <p className="text-slate-400 text-xs mb-1">Current Patient</p>
              <p className="text-white font-semibold">{patient.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  patient.severity_score >= 8 ? 'bg-red-600 text-white' :
                  patient.severity_score >= 5 ? 'bg-orange-500 text-white' :
                  patient.severity_score >= 3 ? 'bg-yellow-500 text-black' : 'bg-green-600 text-white'
                }`}>{patient.severity_label} {patient.severity_score}/10</span>
              </div>
              <p className="text-slate-300 text-xs mt-1.5">{patient.symptoms}</p>
            </div>
          )}

          <button
            onClick={toggleOccupied}
            disabled={toggling}
            className={`w-full py-3.5 rounded-xl font-bold text-white text-base transition-colors disabled:opacity-50 ${room.is_occupied ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {toggling ? 'Updating...' : room.is_occupied ? 'Mark Available' : 'Mark Occupied'}
          </button>
          <p className="text-slate-600 text-xs mt-2">
            Updated {new Date(room.updated_at).toLocaleTimeString()}
          </p>
        </div>

        {/* Supplies */}
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-slate-300 font-semibold text-sm">{room.department} Supplies</h2>
            <span className="text-slate-500 text-xs">Tap ± to adjust</span>
          </div>
          {supplies.length === 0 ? (
            <p className="text-slate-500 text-sm">No supplies tracked for this department</p>
          ) : (
            <div className="space-y-2">
              {supplies.map((s) => {
                const isLow = s.quantity <= s.low_threshold;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${isLow ? 'bg-red-950 border border-red-700' : 'bg-slate-700'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-100 text-sm font-medium">{s.name}</span>
                        {isLow && (
                          <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                            PRIORITY
                          </span>
                        )}
                      </div>
                      <p className="text-slate-500 text-xs">Min: {s.low_threshold}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => adjustSupply(s, -1)}
                        disabled={s.quantity === 0 || adjusting === s.id}
                        className="w-8 h-8 bg-slate-600 hover:bg-red-800 disabled:opacity-30 text-white rounded-lg font-bold text-base transition-colors flex items-center justify-center"
                      >
                        −
                      </button>
                      <span className={`w-8 text-center font-bold text-base ${isLow ? 'text-red-400' : 'text-white'}`}>
                        {s.quantity}
                      </span>
                      <button
                        onClick={() => adjustSupply(s, +1)}
                        disabled={adjusting === s.id}
                        className="w-8 h-8 bg-slate-600 hover:bg-green-800 text-white rounded-lg font-bold text-base transition-colors flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
