'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ArrowLeft, Activity, Calendar } from 'lucide-react';
import Navbar from '@/components/common/Navbar';
import { useAuth } from '@/context/AuthContext';

export default function PatientHistoryRecords({ params }) {
  const router = useRouter();
  const { token } = useAuth();
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // In Next.js 15+, params is a Promise that must be unwrapped
  const resolvedParams = use(params);

  useEffect(() => {
    if (!token) return;

    const fetchPatientData = async () => {
      try {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${API_BASE_URL}/patients/${resolvedParams.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!res.ok) {
          throw new Error('Failed to fetch patient history records');
        }

        const data = await res.json();
        setPatient(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPatientData();
  }, [resolvedParams.id, token]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 sm:p-8">
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-teal-600 transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="pulse-loader">
              <div></div>
              <div></div>
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-400">Loading diagnostic records...</p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-3">
            <Activity className="h-6 w-6 shrink-0" />
            <div>
              <strong>Error Loading Records:</strong> {error}
            </div>
          </div>
        ) : !patient ? (
          <div className="text-center p-10 text-slate-500">Patient not found</div>
        ) : (
          <div className="glass p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-start gap-4 mb-8 pb-8 border-b border-slate-200 dark:border-slate-800">
              <div className="p-4 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-2xl">
                <FileText className="h-8 w-8" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100">
                  {patient.name}
                </h1>
                <div className="flex flex-wrap gap-4 mt-3 text-sm font-semibold text-slate-500">
                  <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                    Gender: {patient.gender}
                  </span>
                  <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                    Age: {patient.age}
                  </span>
                  <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                    Contact: {patient.phoneNumber}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-teal-500" />
                  Clinical History & Diagnostics
                </h3>
                <div className="p-6 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                  {patient.medicalHistory ? (
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                      {patient.medicalHistory}
                    </p>
                  ) : (
                    <p className="text-slate-400 italic">No historical clinical data recorded for this patient.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2 mt-8">
                  <Calendar className="h-5 w-5 text-teal-500" />
                  Past Appointments
                </h3>
                {patient.appointments && patient.appointments.length > 0 ? (
                  <div className="grid gap-4">
                    {patient.appointments.map(app => (
                      <div key={app.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-500/5 flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-700 dark:text-slate-200">{new Date(app.appointmentDate).toLocaleDateString()} - {new Date(app.appointmentDate).toLocaleTimeString()}</p>
                          <p className="text-sm text-slate-500 mt-1">Reason: {app.reason || 'Not specified'}</p>
                        </div>
                        <span className={`px-3 py-1 text-xs font-bold uppercase rounded-full tracking-wide ${app.status === 'COMPLETED' ? 'bg-teal-500/10 text-teal-600' : app.status === 'CANCELLED' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                          {app.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 italic p-4 bg-slate-500/5 rounded-xl border border-slate-200 dark:border-slate-800">No past appointments found.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
