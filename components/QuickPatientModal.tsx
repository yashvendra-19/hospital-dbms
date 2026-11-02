'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, UserPlus } from 'lucide-react';
import { useToast } from './ToastContext';
import Modal from './fx/Modal';
import Segmented from './fx/Segmented';
import { useSession } from './auth/SessionContext';

interface QuickPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPatientCreated: (patient: any) => void;
}

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const isMinor = (dob: string) => {
  const d = new Date(dob);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return d > cutoff;
};

export default function QuickPatientModal({ isOpen, onClose, onPatientCreated }: QuickPatientModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    national_health_id: `NHID-IND-${Math.floor(1000 + Math.random() * 9000)}`,
    full_name: '',
    gender: 'M',
    dob: '1990-01-01',
    blood_group: 'O+',
    primary_phone: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    privacy_level: 'standard',
    restriction_reason: '',
  });
  const { session } = useSession();
  const canRestrict = session?.role === 'Doctor' || session?.role === 'Admin';
  const set = (k: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData({ ...formData, [k]: e.target.value });
  const minor = isMinor(formData.dob);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to register patient');
      toast({
        type: 'success',
        title: 'Patient Registered',
        message: `${data.patient.full_name} (${data.patient.national_health_id}) successfully enrolled.`,
      });
      onPatientCreated(data.patient);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error creating patient');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-xl" glow="148,116,255">
      <div className="flex items-center gap-3 pb-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-plasma-400/40 bg-plasma-500/15 text-plasma-400">
          <UserPlus className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-display text-lg font-bold text-fg">Quick patient registration</h3>
          <p className="text-xs text-fg2">Rapid intake · inserts into <code className="font-mono text-plasma-400">patients</code></p>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">National Health ID *</label>
            <input required value={formData.national_health_id} onChange={set('national_health_id')} className="field font-mono" />
          </div>
          <div>
            <label className="label">Full name *</label>
            <input required value={formData.full_name} onChange={set('full_name')} className="field" placeholder="e.g. Anand Kumar" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Gender *</label>
            <Segmented
              id="gender"
              value={formData.gender}
              onChange={(v) => setFormData({ ...formData, gender: v })}
              options={[
                { value: 'M', label: 'Male' },
                { value: 'F', label: 'Female' },
                { value: 'O', label: 'Other' },
              ]}
            />
          </div>
          <div>
            <label className="label">Date of birth *</label>
            <input type="date" required value={formData.dob} onChange={set('dob')} className="field" />
          </div>
        </div>

        <div>
          <label className="label">Blood group *</label>
          <div className="grid grid-cols-8 gap-1.5">
            {BLOOD.map((bg) => {
              const active = formData.blood_group === bg;
              return (
                <motion.button
                  key={bg}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setFormData({ ...formData, blood_group: bg })}
                  className={`relative rounded-lg border py-2 font-mono text-xs font-bold transition ${
                    active ? 'border-rose-400/60 text-fg' : 'border-tint/[0.14] text-fg2 hover:text-fg'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="blood"
                      className="absolute inset-0 rounded-lg bg-rose-500/20"
                    />
                  )}
                  <span className="relative">{bg}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">Primary phone (10 digits) *</label>
          <input
            type="tel"
            required
            maxLength={10}
            value={formData.primary_phone}
            onChange={set('primary_phone')}
            className="field font-mono"
            placeholder="9876543210"
          />
        </div>

        <div className={`rounded-xl border p-3 transition-colors ${minor ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-tint/[0.11]'}`}>
          <AnimatePresence>
            {minor && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 font-mono text-[10.5px] text-amber-300"
              >
                Under 18 → chk_minor_emergency_contact requires a guardian
              </motion.p>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Emergency contact{minor ? ' *' : ''}</label>
              <input value={formData.emergency_contact_name} onChange={set('emergency_contact_name')} className="field" placeholder="Next of kin" />
            </div>
            <div>
              <label className="label">Emergency phone{minor ? ' *' : ''}</label>
              <input
                type="tel"
                maxLength={10}
                value={formData.emergency_contact_phone}
                onChange={set('emergency_contact_phone')}
                className="field font-mono"
                placeholder="9876543219"
              />
            </div>
          </div>
        </div>

        {canRestrict && (
          <div className="rounded-xl border border-plasma-400/25 bg-plasma-500/[0.05] p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-fg">
              <input
                type="checkbox"
                className="h-4 w-4 accent-violet-400"
                checked={formData.privacy_level === 'restricted'}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    privacy_level: e.target.checked ? 'restricted' : 'standard',
                    restriction_reason: e.target.checked ? formData.restriction_reason || 'Medico-legal case (MLC)' : '',
                  })
                }
              />
              Restricted record (visible only to the treating doctor, admins and break-glass)
            </label>
            {formData.privacy_level === 'restricted' && (
              <select value={formData.restriction_reason} onChange={set('restriction_reason')} className="field mt-2 text-xs">
                <option>Medico-legal case (MLC)</option>
                <option>VIP / public figure</option>
                <option>Sensitive diagnosis (HIV, psychiatric)</option>
                <option>Survivor of violence</option>
              </select>
            )}
            <p className="mt-1.5 text-[10.5px] text-fg3">Enforced by the RLS policy pol_patients_read; nurses cannot create restricted records.</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-semibold text-fg2 transition hover:bg-tint/5 hover:text-fg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-pulse-400 px-5 py-2.5 text-xs font-bold text-[#04121a] hover:bg-pulse-300 transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Registering…' : 'Register patient'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
